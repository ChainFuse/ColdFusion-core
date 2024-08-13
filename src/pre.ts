import { isFeatureAvailable as isGhCacheAvailable } from '@actions/cache';
import { exportVariable, getBooleanInput, getInput, info, warning } from '@actions/core';
import { exec } from '@actions/exec';
import { getOctokit } from '@actions/github';
import { cacheFile, downloadTool } from '@actions/tool-cache';
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { constants, mkdir } from 'node:fs/promises';
import { clean, coerce, satisfies } from 'semver';
import { BaseCore } from './base.js';
import { FileHasher } from './fileHasher.js';

export class PreCore extends BaseCore {
	private requestedOllamaVersion = getInput('ollama-version', { required: true, trimWhitespace: true });
	private forceCheck = getBooleanInput('check-latest', { required: true, trimWhitespace: true });

	constructor() {
		super();

		exportVariable('COLDFUSION_CORE_PRE_EXECUTED', `${true}`);
	}

	private static get ollamaInstalled() {
		return exec('ollama', undefined, { silent: true })
			.then((exitCode) => {
				console.debug('ollama exit code', exitCode);
				return true;
			})
			.catch();
	}

	private get ollamaVersion() {
		return getOctokit(getInput('token', { required: true, trimWhitespace: true }))
			.rest.repos.listReleases({
				owner: 'ollama',
				repo: 'ollama',
				per_page: 100,
			})
			.then(({ data }) => {
				console.info('releases', data);

				return data.find((release) => {
					const releaseVersion = clean(release.tag_name);
					console.info('release', release, this.requestedOllamaVersion, releaseVersion, satisfies(this.requestedOllamaVersion, releaseVersion));

					if (releaseVersion) {
						return satisfies(this.requestedOllamaVersion, releaseVersion);
					} else {
						return false;
					}
				});
			})
			.catch((e) => {
				throw e;
			});
	}

	private installOllama() {
		return this.ollamaVersion.then((release) => {
			const executableAsset = release?.assets.find((asset) => asset.name.toLowerCase().includes('darwin') && !asset.name.toLowerCase().endsWith('.zip'));
			const hashAsset = release?.assets.find((asset) => /^sha\d{3}sum/i.test(asset.name.toLowerCase()));
			if (executableAsset && hashAsset) {
				return Promise.all([
					downloadTool(executableAsset!.browser_download_url, '/usr/local/bin/ollama'),
					fetch(new URL(hashAsset!.browser_download_url))
						.then((response) => response.text())
						.then((hashFile) => {
							const lines = hashFile.split('\n');
							const line = lines.find((line) => line.endsWith(executableAsset!.name));
							if (line) {
								return line;
							} else {
								throw new Error('file not in hashes', { cause: lines });
							}
						}),
				]).then(([ollamaToolGuid, ollamaHashLine]) => {
					const hashType = /^sha\d{3}/i.exec(hashAsset!.name.toLowerCase())![0];
					const [expectedHash] = ollamaHashLine.split(' ');
					return FileHasher.hashFile(ollamaToolGuid, hashType).then((computedHash) => {
						if (timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(expectedHash!, 'hex'))) {
							return cacheFile(ollamaToolGuid, '/usr/local/bin/ollama', 'ollama', coerce(release!.tag_name)!.toString());
						} else {
							throw new Error('Hash mismatch', { cause: JSON.stringify({ expected: expectedHash, computed: computedHash }) });
						}
					});
				});
			} else {
				throw new Error('Executable and hash not found', { cause: JSON.stringify({ executableAsset, hashAsset }) });
			}
		});

		// https://medium.com/@chhaybunsy/unleash-your-machine-learning-models-how-to-customize-ollamas-storage-directory-c9ea1ea2961a
	}

	public async main() {
		info(`Creating folder and parent(s): ${this.modelDir}`);

		/**
		 * @link https://github.com/nischalj10/headless-ollama/blob/master/preload.sh
		 * Install ollama
		 */
		return PreCore.ollamaInstalled
			.then(() => {
				if (this.forceCheck) {
					/**
					 * @todo
					 * */
				}
			})
			.catch(() => {
				return this.installOllama();
			})
			.finally(() =>
				mkdir(this.modelDir, {
					recursive: true,
					// u=rwx,g=rx,o=rx
					mode: constants.S_IRUSR | constants.S_IWUSR | constants.S_IXUSR | constants.S_IRGRP | constants.S_IXGRP | constants.S_IROTH | constants.S_IXOTH,
				})
					.then(() => {
						if (isGhCacheAvailable()) {
						} else {
							warning('Cache service not available. Falling back to download');
						}
					})
					.catch(),
			);
	}
}

await new PreCore().main();
