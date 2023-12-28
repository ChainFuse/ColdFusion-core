import { isFeatureAvailable, restoreCache } from '@actions/cache';
import { endGroup, error, exportVariable, getInput, info, startGroup, warning } from '@actions/core';
import { hashFiles } from '@actions/glob';
import { Chalk } from 'chalk';
import { constants, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { format, join, parse } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Writable } from 'node:stream';
import type { HuggingFaceRepo } from './types.js';

const chalk = new Chalk({ level: 3 });

export class PreSetup {
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

	private downloadModelFromHf(quantMethod: string = getInput('quantMethod', { required: true })) {
		return new Promise<void>((mainResolve, mainReject) => {
			fetch(new URL(`https://huggingface.co/api/models/TheBloke/${this.cleanModelName}-GGUF`))
				.then((jsonResponse) => {
					if (jsonResponse.ok) {
						jsonResponse
							.json()
							.then((jsonContent) => {
								const json = jsonContent as HuggingFaceRepo;

								// Save JSON because it has hash and other important stuff
								const jsonWriteStream = createWriteStream(this.jsonPath, {
									// u=rw,g=r,o=r
									mode: constants.S_IRUSR | constants.S_IWUSR | constants.S_IRGRP | constants.S_IROTH,
								});
								jsonWriteStream.write(JSON.stringify(json));
								jsonWriteStream.end();

								// Get the exact file name for the given quant method
								const filename = this.findFilenameByQuantMethod(json, quantMethod);

								if (filename) {
									const modelDownloadUrl = new URL(join(json.modelId, 'resolve', 'main', filename), 'https://huggingface.co');
									modelDownloadUrl.searchParams.set('download', true.toString());

									fetch(modelDownloadUrl)
										.then((modelResponse) => {
											if (modelResponse.ok) {
												mainResolve(
													new Promise(async (resolve, reject) => {
														const totalSize = parseInt(modelResponse.headers.get('Content-Length') ?? '0', 10);
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

														if (modelResponse.body) {
															try {
																startGroup('Model Download');
																performance.mark('model-start-download');
																for await (const chunk of modelResponse.body) {
																	writer.write(chunk);
																	receivedSize += chunk.length;
																	updateProgress();
																}
																performance.mark('model-end-download');
																// Declare here so it already starts closing
																const writerClosing = writer.close();
																const temp = performance.measure('model-download', 'model-start-download', 'model-end-download');
																info(`Downloaded in ${temp.duration / 1000}s`);
																endGroup();
																// Make sure it really is done
																resolve(writerClosing);
															} catch (error) {
																await writer.abort();
																reject(error);
															}
														} else {
															reject('Bad download body');
														}
													}),
												);
											} else {
												mainReject(modelResponse.status);
											}
										})
										.catch(mainReject);

									mainResolve();
								} else {
									mainReject(quantMethod);
								}
							})
							.catch(mainReject);
					} else {
						mainReject(jsonResponse.status);
					}
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

			const cacheKey = await restoreCache([this.modelDir], baseCacheString + hashFiles(`${this.modelDir}/**`), [baseCacheString], { concurrentBlobDownloads: true }, true);

			if (cacheKey) {
				// TODO: Check if files actually exist
			} else {
				try {
					await this.downloadModelFromHf();
				} catch (err) {
					error((err as Error | string | number).toString());
				}
			}
		} else {
			try {
				await this.downloadModelFromHf();
			} catch (err) {
				error((err as Error | string | number).toString());
			}
		}

		exportVariable('COLDFUSION_CORE_PRE_EXECUTED', `${true}`);
	}
}

await new PreSetup().main();
