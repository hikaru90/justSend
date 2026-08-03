import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../../../tests/helpers/db';
import { createTeam, createDomain } from '../../../tests/helpers/factories';
import {
	activateFlow,
	createFlow,
	defaultFlowGraph,
	deleteFlow,
	getFlow,
	listFlows,
	pauseFlow,
	updateFlow,
} from './flow-service';

beforeEach(() => resetDb());

describe('flow-service', () => {
	function setup() {
		const team = createTeam();
		const domain = createDomain(team.id, { name: 'mail.example.com', status: 'SUCCESS' });
		return { team, domain };
	}

	it('defaultFlowGraph has trigger and end connected', () => {
		const graph = defaultFlowGraph();
		expect(graph.nodes).toHaveLength(2);
		expect(graph.nodes[0].type).toBe('trigger');
		expect(graph.nodes[1].type).toBe('end');
		expect(graph.edges).toHaveLength(1);
		expect(graph.edges[0].source).toBe('trigger-1');
		expect(graph.edges[0].target).toBe('end-1');
	});

	it('creates and lists flows scoped to team/domain', () => {
		const { team, domain } = setup();
		const other = createTeam();
		const otherDomain = createDomain(other.id, { name: 'other.example.com' });

		const flow = createFlow({ teamId: team.id, domainId: domain.id, name: 'Welcome' });
		createFlow({ teamId: other.id, domainId: otherDomain.id, name: 'Other' });

		const listed = listFlows(team.id, domain.id);
		expect(listed).toHaveLength(1);
		expect(listed[0].id).toBe(flow.id);
		expect(listed[0].status).toBe('draft');
		expect(listed[0].graph.nodes).toHaveLength(2);
	});

	it('updates graph, activates, pauses, and deletes', () => {
		const { team, domain } = setup();
		const flow = createFlow({ teamId: team.id, domainId: domain.id, name: 'Seq' });

		const graph = defaultFlowGraph();
		graph.nodes.push({
			id: 'sendEmail-1',
			type: 'sendEmail',
			position: { x: 80, y: 180 },
			data: { label: 'Send', from: `hi@${domain.name}`, subject: 'Hi', templateId: '' },
		});
		graph.edges = [
			{ id: 'e1', source: 'trigger-1', target: 'sendEmail-1' },
			{ id: 'e2', source: 'sendEmail-1', target: 'end-1' },
		];

		const updated = updateFlow(
			flow.id,
			team.id,
			{
				name: 'Updated',
				triggerConfig: { contactBookId: 'book-1' },
				graph,
			},
			domain.id,
		);
		expect(updated.name).toBe('Updated');
		expect(updated.triggerConfig.contactBookId).toBe('book-1');
		expect(updated.graph.nodes).toHaveLength(3);

		expect(activateFlow(flow.id, team.id, domain.id).status).toBe('active');
		expect(pauseFlow(flow.id, team.id, domain.id).status).toBe('paused');

		deleteFlow(flow.id, team.id, domain.id);
		expect(() => getFlow(flow.id, team.id, domain.id)).toThrow('Flow not found');
	});
});
