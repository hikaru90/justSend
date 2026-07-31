import { and, eq } from 'drizzle-orm';
import { cuid, jsonArray, nowIso } from '$lib/utils';
import { renderEmailHtml } from '$lib/email-editor/renderer';
import { db } from '../db';
import {
	automationEnrollments,
	automationExecutionLog,
	contacts,
	emails,
	type AutomationExecutionEvent
} from '../db/schema';
import { enqueue } from '../queue';
import { QUEUES } from '../queue/constants';
import { queueEmail } from './email-queue-service';
import { validateDomainFromEmail } from './domain-service';
import { absolutizeEmailAssetUrls } from '../absolutize-email-urls';
import { env } from '../env';
import {
	getFlowById,
	listActiveFlowsByTrigger,
	type AutomationFlow,
	type FlowGraph
} from './flow-service';
import { getTemplate } from './template-service';

export type Enrollment = typeof automationEnrollments.$inferSelect;

function log(
	flowId: string,
	enrollmentId: string,
	nodeId: string | null,
	event: AutomationExecutionEvent,
	detail?: unknown
): void {
	db.insert(automationExecutionLog)
		.values({
			id: cuid(),
			flowId,
			enrollmentId,
			nodeId,
			event,
			detail: detail !== undefined ? JSON.stringify(detail) : null
		})
		.run();
}

function getEnrollment(id: string): Enrollment | null {
	return db.select().from(automationEnrollments).where(eq(automationEnrollments.id, id)).get() ?? null;
}

function setEnrollment(
	id: string,
	patch: {
		currentNodeId?: string | null;
		status?: 'active' | 'completed' | 'exited';
		waitUntil?: string | null;
	}
): void {
	db.update(automationEnrollments)
		.set({
			...(patch.currentNodeId !== undefined ? { currentNodeId: patch.currentNodeId } : {}),
			...(patch.status !== undefined ? { status: patch.status } : {}),
			...(patch.waitUntil !== undefined ? { waitUntil: patch.waitUntil } : {}),
			updatedAt: nowIso()
		})
		.where(eq(automationEnrollments.id, id))
		.run();
}

export function nextNodeId(graph: FlowGraph, fromNodeId: string): string | null {
	const edge = graph.edges.find((e) => e.source === fromNodeId);
	return edge?.target ?? null;
}

function findNode(graph: FlowGraph, nodeId: string) {
	return graph.nodes.find((n) => n.id === nodeId) ?? null;
}

function alreadyEnrolled(flowId: string, contactId: string): boolean {
	const row = db
		.select({ id: automationEnrollments.id })
		.from(automationEnrollments)
		.where(
			and(
				eq(automationEnrollments.flowId, flowId),
				eq(automationEnrollments.contactId, contactId),
				eq(automationEnrollments.status, 'active')
			)
		)
		.get();
	return Boolean(row);
}

function parseWaitMs(data: Record<string, unknown>): number {
	const amount = Number(data.amount ?? 1);
	const unit = String(data.unit ?? 'hours');
	const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : 1;
	switch (unit) {
		case 'minutes':
			return safeAmount * 60_000;
		case 'days':
			return safeAmount * 86_400_000;
		case 'hours':
		default:
			return safeAmount * 3_600_000;
	}
}

export function enrollContact(input: {
	flow: AutomationFlow;
	contactId: string;
}): Enrollment | null {
	if (alreadyEnrolled(input.flow.id, input.contactId)) {
		return null;
	}

	const triggerNode = input.flow.graph.nodes.find((n) => n.type === 'trigger');
	if (!triggerNode) return null;

	const first = nextNodeId(input.flow.graph, triggerNode.id);
	const id = cuid();

	const enrollment = db
		.insert(automationEnrollments)
		.values({
			id,
			flowId: input.flow.id,
			contactId: input.contactId,
			status: 'active',
			currentNodeId: first,
			waitUntil: null
		})
		.returning()
		.get();

	log(input.flow.id, id, triggerNode.id, 'entered', { contactId: input.contactId });

	if (first) {
		enqueue(QUEUES.FLOW_STEP, { enrollmentId: id }, { jobId: `flow-step-${id}-start` });
	} else {
		setEnrollment(id, { currentNodeId: null, status: 'completed' });
		log(input.flow.id, id, triggerNode.id, 'completed', {});
	}

	return enrollment;
}

async function executeSendEmail(
	enrollment: Enrollment,
	flow: AutomationFlow,
	node: FlowGraph['nodes'][number]
): Promise<void> {
	const contact = db.select().from(contacts).where(eq(contacts.id, enrollment.contactId)).get();
	if (!contact) {
		setEnrollment(enrollment.id, { status: 'exited' });
		log(flow.id, enrollment.id, node.id, 'error', { message: 'Contact not found' });
		return;
	}

	if (!contact.subscribed) {
		setEnrollment(enrollment.id, { status: 'exited' });
		log(flow.id, enrollment.id, node.id, 'error', { message: 'Contact unsubscribed' });
		return;
	}

	const templateId = String(node.data.templateId ?? '');
	const from = String(node.data.from ?? '').trim();
	const subjectOverride = String(node.data.subject ?? '').trim();

	if (!from) {
		setEnrollment(enrollment.id, { status: 'exited' });
		log(flow.id, enrollment.id, node.id, 'error', { message: 'Missing from address' });
		return;
	}

	let html = '<p>Hello</p>';
	let subject = subjectOverride || 'Hello';
	let domainId = flow.domainId;
	let region = 'us-east-1';

	try {
		const domain = await validateDomainFromEmail(from, flow.teamId);
		domainId = domain.id;
		region = domain.region;
	} catch (err) {
		setEnrollment(enrollment.id, { status: 'exited' });
		log(flow.id, enrollment.id, node.id, 'error', {
			message: err instanceof Error ? err.message : String(err)
		});
		return;
	}

	if (templateId) {
		try {
			const template = getTemplate(templateId, flow.teamId, flow.domainId);
			html = absolutizeEmailAssetUrls(
				renderEmailHtml(template.content, template.html, {
					email: contact.email,
					firstName: contact.firstName ?? '',
					lastName: contact.lastName ?? ''
				}),
				env.HOST_URL
			);
			if (!subjectOverride) {
				subject = template.subject;
			}
		} catch (err) {
			setEnrollment(enrollment.id, { status: 'exited' });
			log(flow.id, enrollment.id, node.id, 'error', {
				message: err instanceof Error ? err.message : String(err)
			});
			return;
		}
	} else if (subjectOverride) {
		html = `<p>${subjectOverride}</p>`;
	}

	const email = db
		.insert(emails)
		.values({
			id: cuid(),
			to: jsonArray([contact.email]),
			from,
			subject,
			html,
			teamId: flow.teamId,
			domainId,
			contactId: contact.id,
			latestStatus: 'QUEUED'
		})
		.returning()
		.get();

	queueEmail(email.id, flow.teamId, region, false);
	log(flow.id, enrollment.id, node.id, 'email_queued', { emailId: email.id });

	const next = nextNodeId(flow.graph, node.id);
	if (!next) {
		setEnrollment(enrollment.id, { currentNodeId: node.id, status: 'completed' });
		log(flow.id, enrollment.id, node.id, 'completed', {});
		return;
	}

	setEnrollment(enrollment.id, { currentNodeId: next, waitUntil: null });
	enqueue(
		QUEUES.FLOW_STEP,
		{ enrollmentId: enrollment.id },
		{ jobId: `flow-step-${enrollment.id}-${next}` }
	);
}

export async function processFlowStep(payload: unknown): Promise<void> {
	const { enrollmentId, resumeWait } = (payload ?? {}) as {
		enrollmentId?: string;
		resumeWait?: boolean;
	};
	if (!enrollmentId) return;

	let enrollment = getEnrollment(enrollmentId);
	if (!enrollment || enrollment.status !== 'active') return;

	const flow = getFlowById(enrollment.flowId);
	if (!flow || flow.status !== 'active') return;

	if (resumeWait && enrollment.currentNodeId) {
		const waitNode = findNode(flow.graph, enrollment.currentNodeId);
		if (waitNode?.type === 'wait') {
			const next = nextNodeId(flow.graph, waitNode.id);
			if (!next) {
				setEnrollment(enrollment.id, {
					currentNodeId: waitNode.id,
					status: 'completed',
					waitUntil: null
				});
				log(flow.id, enrollment.id, waitNode.id, 'completed', {});
				return;
			}
			setEnrollment(enrollment.id, { currentNodeId: next, waitUntil: null });
			enrollment = getEnrollment(enrollmentId)!;
		}
	}

	if (!enrollment.currentNodeId) {
		setEnrollment(enrollment.id, { status: 'completed' });
		return;
	}

	const node = findNode(flow.graph, enrollment.currentNodeId);
	if (!node) {
		setEnrollment(enrollment.id, { currentNodeId: null, status: 'completed' });
		log(flow.id, enrollment.id, enrollment.currentNodeId, 'error', { message: 'missing_node' });
		return;
	}

	const type = node.type ?? 'default';

	if (type === 'end') {
		setEnrollment(enrollment.id, { currentNodeId: node.id, status: 'completed' });
		log(flow.id, enrollment.id, node.id, 'completed', {});
		return;
	}

	if (type === 'wait') {
		const delayMs = parseWaitMs(node.data);
		const waitUntil = new Date(Date.now() + delayMs).toISOString();
		setEnrollment(enrollment.id, { waitUntil });
		log(flow.id, enrollment.id, node.id, 'wait_scheduled', { waitUntil });
		enqueue(
			QUEUES.FLOW_WAIT,
			{ enrollmentId: enrollment.id, resumeWait: true },
			{ jobId: `flow-wait-${enrollment.id}-${node.id}`, delayMs }
		);
		return;
	}

	if (type === 'sendEmail') {
		await executeSendEmail(enrollment, flow, node);
		return;
	}

	// trigger / unknown: skip forward
	const next = nextNodeId(flow.graph, node.id);
	if (!next) {
		setEnrollment(enrollment.id, { currentNodeId: node.id, status: 'completed' });
		log(flow.id, enrollment.id, node.id, 'completed', {});
		return;
	}
	setEnrollment(enrollment.id, { currentNodeId: next });
	enqueue(
		QUEUES.FLOW_STEP,
		{ enrollmentId: enrollment.id },
		{ jobId: `flow-step-${enrollment.id}-${next}` }
	);
}

export function handleContactCreated(payload: {
	id: string;
	email: string;
	contactBookId: string;
	teamId?: number;
}): number {
	const flows = listActiveFlowsByTrigger('contact.created', payload.contactBookId, payload.teamId);
	let enrolled = 0;
	for (const flow of flows) {
		const result = enrollContact({ flow, contactId: payload.id });
		if (result) enrolled += 1;
	}
	return enrolled;
}
