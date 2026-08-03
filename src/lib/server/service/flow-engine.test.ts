import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetDb, db } from '../../../tests/helpers/db';
import {
	createTeam,
	createDomain,
	createContactBook,
	createContact,
} from '../../../tests/helpers/factories';
import { automationEnrollments, automationExecutionLog, queueJobs } from '$lib/server/db/schema';
import { QUEUES } from '../queue/constants';
import { activateFlow, createFlow, defaultFlowGraph, getFlow, updateFlow } from './flow-service';
import { enrollContact, handleContactCreated, nextNodeId, processFlowStep } from './flow-engine';

beforeEach(() => resetDb());

describe('flow-engine', () => {
	function setup() {
		const team = createTeam();
		const domain = createDomain(team.id, { name: 'mail.example.com', status: 'SUCCESS' });
		const book = createContactBook(team.id, { domainId: domain.id });
		const contact = createContact(book.id, { email: 'user@example.com', subscribed: true });
		return { team, domain, book, contact };
	}

	it('nextNodeId follows the first outgoing edge', () => {
		const graph = defaultFlowGraph();
		expect(nextNodeId(graph, 'trigger-1')).toBe('end-1');
		expect(nextNodeId(graph, 'end-1')).toBeNull();
	});

	it('enrolls contact and completes a linear end-only flow', async () => {
		const { team, domain, book, contact } = setup();
		const flow = createFlow({
			teamId: team.id,
			domainId: domain.id,
			name: 'End only',
			triggerConfig: { contactBookId: book.id },
		});
		activateFlow(flow.id, team.id, domain.id);

		const enrollment = enrollContact({
			flow: getFlow(flow.id, team.id, domain.id),
			contactId: contact.id,
		});
		expect(enrollment).not.toBeNull();
		expect(enrollment!.currentNodeId).toBe('end-1');

		await processFlowStep({ enrollmentId: enrollment!.id });

		const done = db
			.select()
			.from(automationEnrollments)
			.where(eq(automationEnrollments.id, enrollment!.id))
			.get();
		expect(done?.status).toBe('completed');

		const logs = db
			.select()
			.from(automationExecutionLog)
			.where(eq(automationExecutionLog.enrollmentId, enrollment!.id))
			.all();
		expect(logs.some((l) => l.event === 'completed')).toBe(true);
	});

	it('schedules a wait and resumes past it', async () => {
		const { team, domain, book, contact } = setup();
		const flow = createFlow({
			teamId: team.id,
			domainId: domain.id,
			name: 'Wait flow',
			triggerConfig: { contactBookId: book.id },
		});

		const graph = {
			nodes: [
				{
					id: 'trigger-1',
					type: 'trigger',
					position: { x: 0, y: 0 },
					data: { label: 'Contact created' },
				},
				{
					id: 'wait-1',
					type: 'wait',
					position: { x: 0, y: 100 },
					data: { label: 'Wait', amount: 1, unit: 'minutes' },
				},
				{ id: 'end-1', type: 'end', position: { x: 0, y: 200 }, data: { label: 'End' } },
			],
			edges: [
				{ id: 'e1', source: 'trigger-1', target: 'wait-1' },
				{ id: 'e2', source: 'wait-1', target: 'end-1' },
			],
		};
		updateFlow(flow.id, team.id, { graph }, domain.id);
		activateFlow(flow.id, team.id, domain.id);

		const enrollment = enrollContact({
			flow: getFlow(flow.id, team.id, domain.id),
			contactId: contact.id,
		});
		expect(enrollment!.currentNodeId).toBe('wait-1');

		await processFlowStep({ enrollmentId: enrollment!.id });

		const waiting = db
			.select()
			.from(automationEnrollments)
			.where(eq(automationEnrollments.id, enrollment!.id))
			.get();
		expect(waiting?.status).toBe('active');
		expect(waiting?.waitUntil).toBeTruthy();

		const waitJobs = db.select().from(queueJobs).where(eq(queueJobs.queue, QUEUES.FLOW_WAIT)).all();
		expect(waitJobs.length).toBeGreaterThan(0);

		await processFlowStep({ enrollmentId: enrollment!.id, resumeWait: true });

		const done = db
			.select()
			.from(automationEnrollments)
			.where(eq(automationEnrollments.id, enrollment!.id))
			.get();
		expect(done?.status).toBe('completed');
	});

	it('queues sendEmail and advances to end', async () => {
		const { team, domain, book, contact } = setup();
		const flow = createFlow({
			teamId: team.id,
			domainId: domain.id,
			name: 'Send flow',
			triggerConfig: { contactBookId: book.id },
		});

		const graph = {
			nodes: [
				{
					id: 'trigger-1',
					type: 'trigger',
					position: { x: 0, y: 0 },
					data: { label: 'Contact created' },
				},
				{
					id: 'sendEmail-1',
					type: 'sendEmail',
					position: { x: 0, y: 100 },
					data: {
						label: 'Send',
						from: `hi@${domain.name}`,
						subject: 'Hello',
						templateId: '',
					},
				},
				{ id: 'end-1', type: 'end', position: { x: 0, y: 200 }, data: { label: 'End' } },
			],
			edges: [
				{ id: 'e1', source: 'trigger-1', target: 'sendEmail-1' },
				{ id: 'e2', source: 'sendEmail-1', target: 'end-1' },
			],
		};
		updateFlow(flow.id, team.id, { graph }, domain.id);
		activateFlow(flow.id, team.id, domain.id);

		const enrollment = enrollContact({
			flow: getFlow(flow.id, team.id, domain.id),
			contactId: contact.id,
		});

		await processFlowStep({ enrollmentId: enrollment!.id });

		const afterSend = db
			.select()
			.from(automationEnrollments)
			.where(eq(automationEnrollments.id, enrollment!.id))
			.get();
		expect(afterSend?.currentNodeId).toBe('end-1');

		const logs = db
			.select()
			.from(automationExecutionLog)
			.where(eq(automationExecutionLog.enrollmentId, enrollment!.id))
			.all();
		expect(logs.some((l) => l.event === 'email_queued')).toBe(true);

		await processFlowStep({ enrollmentId: enrollment!.id });
		const done = db
			.select()
			.from(automationEnrollments)
			.where(eq(automationEnrollments.id, enrollment!.id))
			.get();
		expect(done?.status).toBe('completed');
	});

	it('handleContactCreated enrolls into matching active flows', () => {
		const { team, domain, book, contact } = setup();
		const flow = createFlow({
			teamId: team.id,
			domainId: domain.id,
			name: 'On create',
			triggerConfig: { contactBookId: book.id },
		});
		activateFlow(flow.id, team.id, domain.id);

		const count = handleContactCreated({
			id: contact.id,
			email: contact.email,
			contactBookId: book.id,
			teamId: team.id,
		});
		expect(count).toBe(1);

		const enrollments = db
			.select()
			.from(automationEnrollments)
			.where(eq(automationEnrollments.flowId, flow.id))
			.all();
		expect(enrollments).toHaveLength(1);
	});

	it('does not double-enroll the same contact', () => {
		const { team, domain, book, contact } = setup();
		const flow = createFlow({
			teamId: team.id,
			domainId: domain.id,
			name: 'Once',
			triggerConfig: { contactBookId: book.id },
		});
		activateFlow(flow.id, team.id, domain.id);
		const active = getFlow(flow.id, team.id, domain.id);

		expect(enrollContact({ flow: active, contactId: contact.id })).not.toBeNull();
		expect(enrollContact({ flow: active, contactId: contact.id })).toBeNull();
	});
});
