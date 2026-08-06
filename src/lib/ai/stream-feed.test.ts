import { describe, expect, it } from 'vitest';
import { applyAiStreamEvent, createAiFeedReducer, owlProgressToStreamEvent } from './stream-feed';

describe('stream-feed', () => {
	it('records system and context blocks', () => {
		const reducer = createAiFeedReducer();
		applyAiStreamEvent(reducer, { type: 'system', content: 'You are a coding agent.' });
		applyAiStreamEvent(reducer, { type: 'context', content: '# design.md\nPrimary: #111' });
		expect(reducer.feed.map((l) => l.kind)).toEqual(['system', 'context']);
	});

	it('maps owl progress events', () => {
		expect(owlProgressToStreamEvent({ stage: 'system', system: 'sys' })).toEqual({
			type: 'system',
			content: 'sys',
		});
		expect(owlProgressToStreamEvent({ stage: 'delta', delta: '{' })).toEqual({
			type: 'delta',
			delta: '{',
		});
	});
});
