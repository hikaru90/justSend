import { describe, it, expect } from 'vitest';
import { applySlotTemplate } from './slot-template';

describe('slot-template', () => {
	it('applies slots and owl-if', () => {
		const html = `<!--owl-if:eyebrow--><p>{{eyebrow}}</p><!--/owl-if--><h1>{{headline}}</h1>`;
		expect(applySlotTemplate(html, { headline: 'Hi', eyebrow: '' })).toBe('<h1>Hi</h1>');
	});
});
