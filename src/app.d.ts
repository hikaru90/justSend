// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			user: {
				id: number;
				name: string | null;
				email: string | null;
				image: string | null;
				isAdmin: boolean;
			} | null;
			teams: Array<{
				id: number;
				name: string;
				role: 'ADMIN' | 'MEMBER';
				isActive: boolean;
				dailyEmailLimit: number;
				isBlocked: boolean;
			}>;
			teamId: number | null;
			team: {
				id: number;
				name: string;
				role: 'ADMIN' | 'MEMBER';
				isActive: boolean;
				dailyEmailLimit: number;
				isBlocked: boolean;
			} | null;
		}
	}
}

export {};
