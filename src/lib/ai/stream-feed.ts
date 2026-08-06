/** Shared AI/Pi stream feed line — used by EmailBuilder and OwlStudio. */
export type AiFeedLine = {
	id: number;
	kind: 'user' | 'step' | 'system' | 'context' | 'thinking' | 'text' | 'tool' | 'error';
	label: string;
	detail?: string;
	pending?: boolean;
	error?: boolean;
};

/** Normalized stream event from Pi SSE or Owl AI SSE endpoints. */
export type AiStreamEvent = {
	type: string;
	message?: string;
	content?: string;
	delta?: string;
	tool?: string;
	toolName?: string;
	toolCallId?: string;
	isError?: boolean;
};

export type AiFeedReducer = {
	feed: AiFeedLine[];
	nextId: number;
	openTools: Record<string, number>;
};

export function createAiFeedReducer(): AiFeedReducer {
	return { feed: [], nextId: 0, openTools: {} };
}

function appendLine(reducer: AiFeedReducer, line: Omit<AiFeedLine, 'id'>): number {
	const id = ++reducer.nextId;
	reducer.feed = [...reducer.feed, { ...line, id }];
	return id;
}

function patchLine(reducer: AiFeedReducer, id: number, patch: Partial<AiFeedLine>) {
	reducer.feed = reducer.feed.map((line) => (line.id === id ? { ...line, ...patch } : line));
}

function appendDelta(reducer: AiFeedReducer, kind: 'thinking' | 'text', delta: string) {
	const last = reducer.feed[reducer.feed.length - 1];
	if (last?.kind === kind) {
		patchLine(reducer, last.id, { label: last.label + delta });
		return;
	}
	appendLine(reducer, { kind, label: delta });
}

/** Apply one SSE event to the feed. Mutates `reducer` in place. */
export function applyAiStreamEvent(reducer: AiFeedReducer, event: AiStreamEvent): string | null {
	switch (event.type) {
		case 'user':
			if (event.message) {
				appendLine(reducer, { kind: 'user', label: event.message });
			}
			break;
		case 'step':
		case 'status':
		case 'preparing':
		case 'calling_model':
		case 'saving':
			if (event.message) {
				appendLine(reducer, { kind: 'step', label: event.message });
				return event.message;
			}
			break;
		case 'system':
			if (event.content) {
				appendLine(reducer, { kind: 'system', label: event.content });
			}
			break;
		case 'context':
			if (event.content) {
				appendLine(reducer, { kind: 'context', label: event.content });
			}
			break;
		case 'thinking':
			if (event.delta) {
				appendDelta(reducer, 'thinking', event.delta);
				return 'Thinking…';
			}
			break;
		case 'text':
		case 'delta':
			if (event.delta) {
				appendDelta(reducer, 'text', event.delta);
				return 'Responding…';
			}
			break;
		case 'tool_start': {
			const name = event.tool ?? event.toolName ?? 'tool';
			const id = appendLine(reducer, {
				kind: 'tool',
				label: name,
				detail: event.message,
				pending: true,
			});
			const key = event.toolCallId ?? name;
			reducer.openTools[key] = id;
			return `Using ${name}…`;
		}
		case 'tool_end': {
			const name = event.tool ?? event.toolName ?? 'tool';
			const key = event.toolCallId ?? name;
			const id = reducer.openTools[key];
			if (id != null) {
				patchLine(reducer, id, {
					pending: false,
					error: event.isError,
					detail: event.isError ? 'error' : 'done',
				});
				delete reducer.openTools[key];
			}
			break;
		}
		case 'error':
			if (event.message) {
				appendLine(reducer, { kind: 'error', label: event.message });
			}
			return null;
		case 'cancelled':
			if (event.message) {
				appendLine(reducer, { kind: 'step', label: event.message });
			}
			break;
	}
	return null;
}

/** Map Owl AI `GenerateProgressEvent`-style payloads to {@link AiStreamEvent}. */
export function owlProgressToStreamEvent(event: {
	stage: string;
	message?: string;
	delta?: string;
	system?: string;
	context?: string;
}): AiStreamEvent | null {
	if (event.stage === 'system' && event.system) {
		return { type: 'system', content: event.system };
	}
	if (event.stage === 'context' && event.context) {
		return { type: 'context', content: event.context };
	}
	if (event.stage === 'delta' && event.delta) {
		return { type: 'delta', delta: event.delta };
	}
	if (event.message) {
		return { type: event.stage, message: event.message };
	}
	return null;
}
