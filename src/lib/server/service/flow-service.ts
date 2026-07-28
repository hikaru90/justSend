import { and, desc, eq } from 'drizzle-orm';
import { cuid, nowIso, parseJsonObject } from '$lib/utils';
import { db } from '../db';
import {
	automationFlows,
	type AutomationFlowStatus
} from '../db/schema';

export type FlowGraph = {
	nodes: Array<{
		id: string;
		type?: string;
		position: { x: number; y: number };
		data: Record<string, unknown>;
	}>;
	edges: Array<{
		id: string;
		source: string;
		target: string;
		sourceHandle?: string | null;
		targetHandle?: string | null;
	}>;
};

export type TriggerConfig = {
	contactBookId?: string;
};

export type AutomationFlow = {
	id: string;
	teamId: number;
	domainId: number;
	name: string;
	status: AutomationFlowStatus;
	triggerType: string;
	triggerConfig: TriggerConfig;
	graph: FlowGraph;
	createdAt: string;
	updatedAt: string;
};

type FlowRow = typeof automationFlows.$inferSelect;

function rowToFlow(row: FlowRow): AutomationFlow {
	return {
		id: row.id,
		teamId: row.teamId,
		domainId: row.domainId,
		name: row.name,
		status: row.status,
		triggerType: row.triggerType,
		triggerConfig: parseJsonObject<TriggerConfig>(row.triggerConfig),
		graph: parseJsonObject<FlowGraph>(row.graph, { nodes: [], edges: [] }),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

export function defaultFlowGraph(): FlowGraph {
	return {
		nodes: [
			{
				id: 'trigger-1',
				type: 'trigger',
				position: { x: 80, y: 80 },
				data: { label: 'Contact created' }
			},
			{
				id: 'end-1',
				type: 'end',
				position: { x: 80, y: 280 },
				data: { label: 'End' }
			}
		],
		edges: [{ id: 'e-trigger-end', source: 'trigger-1', target: 'end-1' }]
	};
}

export function listFlows(teamId: number, domainId?: number): AutomationFlow[] {
	const conditions = [eq(automationFlows.teamId, teamId)];
	if (domainId !== undefined) {
		conditions.push(eq(automationFlows.domainId, domainId));
	}
	return db
		.select()
		.from(automationFlows)
		.where(and(...conditions))
		.orderBy(desc(automationFlows.updatedAt))
		.all()
		.map(rowToFlow);
}

export function getFlow(id: string, teamId: number, domainId?: number): AutomationFlow {
	const conditions = [eq(automationFlows.id, id), eq(automationFlows.teamId, teamId)];
	if (domainId !== undefined) {
		conditions.push(eq(automationFlows.domainId, domainId));
	}
	const row = db
		.select()
		.from(automationFlows)
		.where(and(...conditions))
		.get();
	if (!row) {
		throw new Error('Flow not found');
	}
	return rowToFlow(row);
}

export function getFlowById(id: string): AutomationFlow | null {
	const row = db.select().from(automationFlows).where(eq(automationFlows.id, id)).get();
	return row ? rowToFlow(row) : null;
}

export function listActiveFlowsByTrigger(
	triggerType: string,
	contactBookId: string,
	teamId?: number
): AutomationFlow[] {
	const conditions = [
		eq(automationFlows.status, 'active'),
		eq(automationFlows.triggerType, triggerType)
	];
	if (teamId !== undefined) {
		conditions.push(eq(automationFlows.teamId, teamId));
	}
	return db
		.select()
		.from(automationFlows)
		.where(and(...conditions))
		.all()
		.map(rowToFlow)
		.filter((f) => f.triggerConfig.contactBookId === contactBookId);
}

export function createFlow(input: {
	teamId: number;
	domainId: number;
	name: string;
	triggerConfig?: TriggerConfig;
}): AutomationFlow {
	const id = cuid();
	const graph = defaultFlowGraph();
	const triggerConfig = input.triggerConfig ?? {};

	db.insert(automationFlows)
		.values({
			id,
			teamId: input.teamId,
			domainId: input.domainId,
			name: input.name,
			status: 'draft',
			triggerType: 'contact.created',
			triggerConfig: JSON.stringify(triggerConfig),
			graph: JSON.stringify(graph)
		})
		.run();

	return getFlow(id, input.teamId, input.domainId);
}

export function updateFlow(
	id: string,
	teamId: number,
	patch: {
		name?: string;
		status?: AutomationFlowStatus;
		triggerType?: string;
		triggerConfig?: TriggerConfig;
		graph?: FlowGraph;
	},
	domainId?: number
): AutomationFlow {
	const existing = getFlow(id, teamId, domainId);
	db.update(automationFlows)
		.set({
			...(patch.name !== undefined ? { name: patch.name } : {}),
			...(patch.status !== undefined ? { status: patch.status } : {}),
			...(patch.triggerType !== undefined ? { triggerType: patch.triggerType } : {}),
			...(patch.triggerConfig !== undefined
				? { triggerConfig: JSON.stringify(patch.triggerConfig) }
				: {}),
			...(patch.graph !== undefined ? { graph: JSON.stringify(patch.graph) } : {}),
			updatedAt: nowIso()
		})
		.where(eq(automationFlows.id, existing.id))
		.run();

	return getFlow(id, teamId, domainId);
}

export function activateFlow(id: string, teamId: number, domainId?: number): AutomationFlow {
	return updateFlow(id, teamId, { status: 'active' }, domainId);
}

export function pauseFlow(id: string, teamId: number, domainId?: number): AutomationFlow {
	return updateFlow(id, teamId, { status: 'paused' }, domainId);
}

export function deleteFlow(id: string, teamId: number, domainId?: number): void {
	const existing = getFlow(id, teamId, domainId);
	db.delete(automationFlows).where(eq(automationFlows.id, existing.id)).run();
}
