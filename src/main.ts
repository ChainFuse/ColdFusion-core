import { PreCore } from './pre.js';

if (process.env['COLDFUSION_CORE_PRE_EXECUTED'] !== `${true}`) {
	await new PreCore().main();
}

export class MainCore {
	constructor() {
		console.log('Hello world');
	}

	public async main() {}
}

await new MainCore().main();
