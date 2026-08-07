/**
 * Owl HTML v1 — deterministic, HTML-first email composition.
 *
 * Public API: compile, compose, slots, fragments, format types.
 */
export * from './format';
export { parseDocument, parseFragment, serialize, walkElements, findComment, spliceAtComment } from './parser';
export { healDocument } from './heal';
export { normalizeDocument } from './normalize';
export { compileOwlHtml } from './compile';
export { composeEmailHtml } from './shell';
export { extractSlots, applySlotValues, slotsFromFragment } from './slots';
export { applyTokens } from './tokens';
export { applyLightOverride } from './light-override';
export { lintDocument } from './lint';
