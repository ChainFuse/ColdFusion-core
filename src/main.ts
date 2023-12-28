import { endGroup, error, getInput, info, startGroup } from '@actions/core';
import { exec } from '@actions/exec';
import { LlamaChatSession, LlamaContext, LlamaModel, type Token } from 'node-llama-cpp';
import { arch, cpus, platform } from 'node:os';
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

	private isMetalSupported() {
		if (cpus().length === 0) {
			return false;
		}

		return cpus()[0]!.model.includes('Apple') && arch() === 'arm64';
	}

	private async pre() {
		if (platform() === 'darwin') {
			if (!this.isMetalSupported()) {
				startGroup('macOS non metal rebuild');

				await exec('node-llama-cpp', ['download', '--no-metal'], {
					listeners: {
						stdout: (data: Buffer) => info(data.toString()),
						stderr: (data: Buffer) => error(data.toString()),
					},
				});

				endGroup();
			}
		}
	}

	public async main() {
		await this.pre();

		const context = new LlamaContext({
			model: new LlamaModel({ modelPath: this.modelPath }),
			threads: cpus().length,
		});
		const session = new LlamaChatSession({ context, printLLamaSystemInfo: false });

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
