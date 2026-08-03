import TriggerNode from './TriggerNode.svelte';
import SendEmailNode from './SendEmailNode.svelte';
import WaitNode from './WaitNode.svelte';
import EndNode from './EndNode.svelte';

export const flowNodeTypes = {
	trigger: TriggerNode,
	sendEmail: SendEmailNode,
	wait: WaitNode,
	end: EndNode,
};
