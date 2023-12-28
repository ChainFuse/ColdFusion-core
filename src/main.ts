import { endGroup, getInput, info, startGroup } from '@actions/core';
import { LlamaChatSession, LlamaContext, LlamaModel, type Token } from 'node-llama-cpp';
import { format, join, parse } from 'node:path';
import { PreCore } from './pre.js';

if (process.env['COLDFUSION_CORE_PRE_EXECUTED'] !== `${true}`) {
	await new PreCore().main();
}

export class MainCore {
	protected cleanModelName: string;
	protected modelDir: string;
	protected modelPath: string;

	constructor() {
		let parts1 = getInput('model', { required: true }).split('/');

		// Remove "TheBloke" from the array if it exists
		parts1 = parts1.filter((part) => part.toLowerCase() !== 'TheBloke'.toLowerCase());

		let parts2 = parts1.join('/').split('-');

		// Remove "GGUF" from the array if it exists
		parts2 = parts2.filter((part) => part.toLowerCase() !== 'GGUF'.toLowerCase());

		this.cleanModelName = parts2.join('-');

		// Do format(parse()) for input validation
		this.modelDir = join(format(parse(getInput('modelDir', { required: true }))), 'ChainFuse', 'ColdFusion', 'models', this.cleanModelName);
		this.modelPath = format({
			dir: this.modelDir,
			name: getInput('quantMethod', { required: true }),
			ext: '.gguf',
		});
	}

	public async main() {
		const model = new LlamaModel({
			modelPath: this.modelPath,
		});
		const context = new LlamaContext({ model });
		const session = new LlamaChatSession({ context });

		startGroup('User Input');
		const q1 = 'Hi there, how are you?';
		info(q1);
		endGroup();

		let tokenCount = 0;
		const startTime = performance.now();

		startGroup('AI Response');
		await session.prompt(q1, {
			onToken(chunk: Token[]) {
				tokenCount += chunk.length;
				info(context.decode(chunk));
			},
		});

		const endTime = performance.now();
		endGroup();

		const durationMs = endTime - startTime;
		const avgMsPerToken = durationMs / tokenCount;
		const tokensPerSecond = tokenCount / (durationMs / 1000);

		info(`Average ms per token: ${avgMsPerToken}`);
		info(`Average tokens per second: ${tokensPerSecond}`);
	}
}

await new MainCore().main();
