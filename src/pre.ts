import { isFeatureAvailable, restoreCache } from '@actions/cache';
import { endGroup, error, exportVariable, getInput, info, startGroup, warning } from '@actions/core';
import { Chalk } from 'chalk';
import { constants, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { format, join, parse } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Writable } from 'node:stream';
import { FileHasher } from './fileHasher.js';
import type { HuggingFaceRepo } from './types.js';

const chalk = new Chalk({ level: 3 });

export class PreCore {
	protected cleanModelName: string;
	protected modelDir: string;
	protected jsonPath: string;
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
		this.jsonPath = format({
			dir: this.modelDir,
			name: 'repo',
			ext: '.json',
		});
		this.modelPath = format({
			dir: this.modelDir,
			name: getInput('quantMethod', { required: true }),
			ext: '.gguf',
		});
	}

	private findFilenameByQuantMethod(data: HuggingFaceRepo, quantMethod: string = getInput('quantMethod', { required: true })) {
		for (const sibling of data.siblings) {
			const filename = sibling.rfilename;

			// Check if the filename matches the desired pattern
			if (filename.toLowerCase().endsWith('.gguf')) {
				const parts = filename.split('.');
				// Ensure there are enough parts in the filename
				if (parts.length > 2) {
					// Get the second-to-last part for the quant method
					const fileQuantMethod = parts[parts.length - 2];
					if (fileQuantMethod?.toLowerCase() === quantMethod.toLowerCase()) {
						return filename; // Return the whole filename
					}
				}
			}
		}

		return null;
	}

	private downloadJson() {
		return new Promise<HuggingFaceRepo>((resolve, reject) => {
			fetch(new URL(`https://huggingface.co/api/models/TheBloke/${this.cleanModelName}-GGUF`))
				.then((response) => {
					if (response.ok) {
						response
							.json()
							.then((json) => {
								resolve(json as HuggingFaceRepo);
							})
							.catch(reject);
					} else {
						reject(response.status);
					}
				})
				.catch(reject);
		});
	}

	private downloadModelBody(totalSize: number, body: NonNullable<Response['body']>) {
		return new Promise<void>(async (resolve, reject) => {
			if (totalSize === 0) warning('Total size unknown, progress will not be shown.');
			let receivedSize = 0;
			let lastUpdate = Date.now();

			const updateProgress = () => {
				if (Date.now() - lastUpdate > 1000) {
					lastUpdate = Date.now();

					const percentage = totalSize ? (receivedSize / totalSize) * 100 : 0;
					const color = chalk.rgb(
						Math.max(Math.floor(100 + (1 - percentage / 100) * 155), 100), // Adjusting red component
						Math.max(Math.floor(100 + (1 - percentage / 100) * 155), 100), // Adjusting green component
						255, // Keeping blue component at max
					);
					info(`Download progress: ${color(`${percentage.toFixed(2)}%`)}`);
				}
			};

			const modelWriter = Writable.toWeb(
				createWriteStream(this.modelPath, {
					// u=rw,g=r,o=r
					mode: constants.S_IRUSR | constants.S_IWUSR | constants.S_IRGRP | constants.S_IROTH,
				}),
			);

			const writer = modelWriter.getWriter();

			try {
				startGroup('Model Download');
				performance.mark('model-start-download');
				for await (const chunk of body) {
					writer.write(chunk);
					receivedSize += chunk.length;
					updateProgress();
				}
				performance.mark('model-end-download');
				// Declare here so it already starts closing
				const writerClosing = writer.close();

				const measurement = performance.measure('model-download', 'model-start-download', 'model-end-download');
				info(`Downloaded in ${measurement.duration / 1000}s`);
				endGroup();

				// Make sure it really is done
				resolve(
					writerClosing.then(() => {
						performance.mark('model-end-write');
						const measurement2 = performance.measure('model-download', 'model-start-download', 'model-end-write');
						info(`Saved in ${measurement2.duration / 1000}s`);
					}),
				);
			} catch (error) {
				await writer.abort();
				reject(error);
			}
		});
	}

	private downloadModel(modelId: string, filename: string) {
		const modelDownloadUrl = new URL(join(modelId, 'resolve', 'main', filename), 'https://huggingface.co');
		modelDownloadUrl.searchParams.set('download', true.toString());

		return new Promise<void>((resolve, reject) => {
			fetch(modelDownloadUrl)
				.then((response) => {
					if (response.ok) {
						if (response.body) {
							this.downloadModelBody(parseInt(response.headers.get('Content-Length') ?? '0', 10), response.body)
								.then(resolve)
								.catch(reject);
						} else {
							reject('Bad download body');
						}
					} else {
						reject(response.status);
					}
				})
				.catch(reject);
		});
	}

	private download(quantMethod: string = getInput('quantMethod', { required: true })) {
		return new Promise<void>((mainResolve, mainReject) => {
			this.downloadJson()
				.then((json) => {
					// Save JSON at the same time moving on
					Promise.all([
						new Promise<void>((resolve, reject) => {
							try {
								// Save JSON because it has hash and other important stuff
								const jsonWriteStream = createWriteStream(this.jsonPath, {
									// u=rw,g=r,o=r
									mode: constants.S_IRUSR | constants.S_IWUSR | constants.S_IRGRP | constants.S_IROTH,
								});
								jsonWriteStream.write(JSON.stringify(json));
								// Have the callback trigger resolve
								jsonWriteStream.end(resolve);
							} catch (error) {
								reject(error);
							}
						}),
						new Promise<void>((resolve, reject) => {
							// Get the exact file name for the given quant method
							const filename = this.findFilenameByQuantMethod(json, quantMethod);

							if (filename) {
								this.downloadModel(json.modelId, filename).then(resolve).catch(reject);
							} else {
								reject(quantMethod);
							}
						}),
					])
						.then(() => mainResolve())
						.catch(mainReject);
				})
				.catch(mainReject);
		});
	}

	public async main() {
		await mkdir(this.modelDir, {
			recursive: true,
			// u=rwx,g=rx,o=rx
			mode: constants.S_IRUSR | constants.S_IWUSR | constants.S_IXUSR | constants.S_IRGRP | constants.S_IXGRP | constants.S_IROTH | constants.S_IXOTH,
		});

		if (isFeatureAvailable()) {
			const baseCacheString = `coldfusion-core-${this.cleanModelName}-`;

			const cacheKey = await restoreCache([this.jsonPath, this.modelPath], baseCacheString + (await FileHasher.hashFiles([this.jsonPath, this.modelPath].join('\n'))), [baseCacheString], { concurrentBlobDownloads: true }, true);

			if (cacheKey) {
				info(chalk.green('Cache found. Checking files'));
				// TODO: Check if files actually exist
			} else {
				warning(chalk.yellow('Cache not found. Falling back to download'));
				try {
					await this.download();
				} catch (err) {
					error((err as Error | string | number).toString());
				}
			}
		} else {
			warning(chalk.yellow('Cache not available. Falling back to download'));
			try {
				await this.download();
			} catch (err) {
				error((err as Error | string | number).toString());
			}
		}

		exportVariable('COLDFUSION_CORE_PRE_EXECUTED', `${true}`);
	}
}

await new PreCore().main();
