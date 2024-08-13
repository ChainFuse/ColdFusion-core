import { isFeatureAvailable as isGhCacheAvailable } from '@actions/cache';
import { exportVariable, getBooleanInput, getInput, info, warning } from '@actions/core';
import { exec } from '@actions/exec';
import { getOctokit } from '@actions/github';
import { cacheFile, downloadTool, evaluateVersions } from '@actions/tool-cache';
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { constants, mkdir } from 'node:fs/promises';
import { clean, coerce } from 'semver';
import { BaseCore } from './base.js';
import { FileHasher } from './fileHasher.js';

export class PreCore extends BaseCore {
	private requestedOllamaVersion = getInput('ollama-version', { required: true, trimWhitespace: true });
	private forceCheck = getBooleanInput('check-latest', { required: true, trimWhitespace: true });
	private octokit = getOctokit(getInput('token', { required: true, trimWhitespace: true }));

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
		return this.octokit
			.paginate('GET /repos/{owner}/{repo}/releases', {
				owner: 'ollama',
				repo: 'ollama',
				// Max 100 https://docs.github.com/en/rest/releases/releases#list-releases
				per_page: 100,
			})
			.then((data) => {
				console.debug('release count', data.length);

				const targetVersion = evaluateVersions(
					data.map((release) => clean(release.tag_name)!),
					this.requestedOllamaVersion,
				);

				return data.find((release) => clean(release.tag_name)! === targetVersion);
			})
			.catch((e) => {
				throw e;
			});
	}

	private installOllama() {
		return this.ollamaVersion.then((release) => {
			const os = getInput('os', { required: true, trimWhitespace: true }).toLowerCase() as 'linux' | 'windows' | 'macos';
			const arch = getInput('arch', { required: true, trimWhitespace: true }).toLowerCase() as 'x86' | 'x64' | 'arm' | 'arm64';
			const executableAsset = release?.assets.find((asset) => {
				switch (os) {
					case 'macos':
						return asset.name.toLowerCase().includes('darwin') && !asset.name.toLowerCase().endsWith('.zip');
					case 'linux':
						switch (arch) {
							case 'x64':
								return asset.name.toLowerCase().includes(os) && !asset.name.toLowerCase().endsWith('amd64');
							case 'arm64':
								return asset.name.toLowerCase().includes(os) && !asset.name.toLowerCase().endsWith(arch);
							default:
								return false;
						}
					case 'windows':
						switch (arch) {
							case 'x64':
								return asset.name.toLowerCase().includes(os) && !asset.name.toLowerCase().endsWith('amd64.zip');
							default:
								return false;
						}
				}
			});
			const hashAsset = release?.assets.find((asset) => /^sha\d{3}sum/i.test(asset.name.toLowerCase()));
			if (executableAsset && hashAsset) {
				return Promise.all([
					downloadTool(executableAsset!.browser_download_url, '/usr/local/bin/ollama'),
					fetch(new URL(hashAsset!.browser_download_url))
						.then((response) => response.text())
						.then((hashFile) => {
							const lines = hashFile.split('\n');
							const [expectedHash] = lines.find((line) => line.endsWith(executableAsset!.name))?.split(' ') ?? [];
							if (expectedHash) {
								return expectedHash;
							} else {
								throw new Error('file not in hashes', { cause: lines });
							}
						}),
				]).then(([ollamaToolGuid, expectedHash]) => {
					console.info('ollamaToolGuid', ollamaToolGuid);
					console.info('ollamaHashLine', expectedHash);

					const hashType = /^sha\d{3}/i.exec(hashAsset!.name.toLowerCase())![0];
					return FileHasher.hashFile(ollamaToolGuid, hashType).then((computedHash) => {
						console.info('expectedHash', expectedHash, 'computedHash', computedHash);

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
