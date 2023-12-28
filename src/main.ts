import { PreSetup } from './pre.js';

if (process.env['COLDFUSION_CORE_PRE_EXECUTED'] !== `${true}`) {
	await new PreSetup().main();
}

console.log('Hello world');
