import { addPath, debug, endGroup, error, exportVariable, getBooleanInput, getInput, info, startGroup } from '@actions/core';
import { exec } from '@actions/exec';
import { getOctokit } from '@actions/github';
import { mkdirP } from '@actions/io';
import { cacheDir, cacheFile, downloadTool, evaluateVersions, extract7z, extractTar, extractXar, extractZip } from '@actions/tool-cache';
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { chmod, constants, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clean, coerce } from 'semver';
import { BaseCore } from './base.js';
import { FileHasher } from './fileHasher.js';

export class PreCore extends BaseCore {
	private arch = getInput('arch', { required: true, trimWhitespace: true }).toLowerCase() as 'x86' | 'x64' | 'arm' | 'arm64';

	private forceCheck = getBooleanInput('check-latest', { required: true, trimWhitespace: true });
	private octokit = getOctokit(getInput('token', { required: true, trimWhitespace: true }));

	constructor() {
		super();

		exportVariable('COLDFUSION_CORE_PRE_EXECUTED', `${true}`);
	}

	private get ollamaInstalled() {
		return exec(this.ollamaPath, undefined, { silent: true })
			.then(() => true)
			.catch((e) => {
				error(`find ${e}`);
				throw e;
			});
	}

	private get ollamaVersionHttp() {
		info('Getting Ollama versions from github releases');
		return this.octokit
			.paginate('GET /repos/{owner}/{repo}/releases', {
				owner: 'ollama',
				repo: 'ollama',
				// Max 100 https://docs.github.com/en/rest/releases/releases#list-releases
				per_page: 100,
			})
			.then((data) => {
				const targetVersion = evaluateVersions(
					data.map((release) => clean(release.tag_name)!),
					this.requestedOllamaVersion,
				);
				info(`User requested ${this.requestedOllamaVersion}; Matched version ${targetVersion}`);

				return data.find((release) => clean(release.tag_name)! === targetVersion);
			})
			.catch((e) => {
				throw e;
			});
	}

	private static modeToString(mode: number): string {
		const permissions = [mode & constants.S_IRUSR ? 'r' : '-', mode & constants.S_IWUSR ? 'w' : '-', mode & constants.S_IXUSR ? 'x' : '-', mode & constants.S_IRGRP ? 'r' : '-', mode & constants.S_IWGRP ? 'w' : '-', mode & constants.S_IXGRP ? 'x' : '-', mode & constants.S_IROTH ? 'r' : '-', mode & constants.S_IWOTH ? 'w' : '-', mode & constants.S_IXOTH ? 'x' : '-'];
		return permissions.join('');
	}

	private installOllama() {
		return this.ollamaVersionHttp.then((release) => {
			const executableAsset = release?.assets.find((asset) => {
				switch (this.os) {
					case 'macos':
						return asset.name.toLowerCase().includes('darwin') && !asset.name.toLowerCase().endsWith('.zip');
					case 'linux':
						switch (this.arch) {
							case 'x64':
								return asset.name.toLowerCase().includes(this.os) && asset.name.toLowerCase().endsWith('amd64');
							case 'arm64':
								return asset.name.toLowerCase().includes(this.os) && asset.name.toLowerCase().endsWith(this.arch);
							default:
								return false;
						}
					case 'windows':
						switch (this.arch) {
							case 'x64':
								return asset.name.toLowerCase().includes(this.os) && asset.name.toLowerCase().endsWith('amd64.zip');
							default:
								return false;
						}
				}
			});
			const hashAsset = release?.assets.find((asset) => /^sha\d{3}sum/i.test(asset.name.toLowerCase()));

			if (executableAsset && hashAsset) {
				const isArchive = ['.zip', '.7z', '.pkg', '.tar.gz', '.tgz'].some((extension) => executableAsset!.name.toLowerCase().endsWith(extension));
				info(`Downloading ${executableAsset.name} to ${tmpdir()}`);

				return Promise.all([
					// Download to tmp if archive otherwise straight to destination
					downloadTool(executableAsset!.browser_download_url, join(tmpdir(), executableAsset!.name)),
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
				]).then(([ollamaPath, expectedHash]) => {
					info(`Downloaded ${ollamaPath}`);

					const hashType = /^sha\d{3}/i.exec(hashAsset!.name.toLowerCase())![0];
					return FileHasher.hashFile(ollamaPath, hashType).then(async (computedHash) => {
						if (timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(expectedHash!, 'hex'))) {
							info(`${isArchive ? 'archive' : 'executable'} ${executableAsset.name} verified against hash`);

							if (isArchive) {
								info('Extracting archive in place');

								if (ollamaPath.endsWith('.zip')) {
									ollamaPath = await extractZip(ollamaPath);
								} else if (ollamaPath.endsWith('.7z')) {
									ollamaPath = await extract7z(ollamaPath);
								} else if (ollamaPath.endsWith('.pkg')) {
									ollamaPath = await extractXar(ollamaPath);
								} else if (['.tar.gz', '.tgz'].some((extension) => executableAsset!.name.toLowerCase().endsWith(extension))) {
									ollamaPath = await extractTar(ollamaPath);
								}

								info(`Extracted ${ollamaPath}`);

								info('Adding execute bit to executable');
								return stat(join(ollamaPath, this.os === 'windows' ? 'ollama.exe' : 'ollama'))
									.then(({ mode }) => {
										debug(`${PreCore.modeToString(mode)} ${join(ollamaPath, this.os === 'windows' ? 'ollama.exe' : 'ollama')}`);
										return chmod(join(ollamaPath, this.os === 'windows' ? 'ollama.exe' : 'ollama'), mode | constants.S_IXUSR).then(() => debug(`${PreCore.modeToString(mode | constants.S_IXUSR)} ${join(ollamaPath, this.os === 'windows' ? 'ollama.exe' : 'ollama')}`));
									})
									.then(() => {
										info("Caching tool archive in github's tool cache");
										return cacheDir(ollamaPath, 'ollama', coerce(release!.tag_name)!.toString()).then((cachedPath) => {
											info(`Cached tool archive ${cachedPath}`);
											addPath(cachedPath);
											info(`Added to path ${cachedPath}`);
										});
									});
							} else {
								info('Adding execute bit to executable');
								return stat(ollamaPath)
									.then(({ mode }) => {
										debug(`${PreCore.modeToString(mode)} ${ollamaPath}`);
										return chmod(ollamaPath, mode | constants.S_IXUSR).then(() => debug(`${PreCore.modeToString(mode | constants.S_IXUSR)} ${ollamaPath}`));
									})
									.then(() => {
										info("Caching tool in github's tool cache");
										return cacheFile(ollamaPath, this.os === 'windows' ? 'ollama.exe' : 'ollama', 'ollama', coerce(release!.tag_name)!.toString()).then((cachedPath) => {
											info(`Cached tool ${cachedPath}`);
											addPath(cachedPath);
											info(`Added to path ${cachedPath}`);
										});
									});
							}
						} else {
							throw new Error('Hash mismatch', { cause: JSON.stringify({ expected: expectedHash, computed: computedHash }) });
						}
					});
				});
			} else {
				throw new Error('Executable and hash not found', { cause: JSON.stringify({ executableAsset, hashAsset }) });
			}
		});
	}

	public async main() {
		/**
		 * @link https://github.com/nischalj10/headless-ollama/blob/master/preload.sh
		 * Install ollama
		 */
		startGroup('Ollama installation');
		info(`Checking if ollama is installed`);
		return this.ollamaInstalled
			.then(() => {
				if (this.forceCheck) {
					/**
					 * @todo
					 * */
				}
			})
			.catch(() => {
				info('Ollama not installed');
				return this.installOllama();
			})
			.finally(() =>
				this.ollamaInstalled.then((ollamaAvailable) => {
					info(`Verifying ollama is usable ${ollamaAvailable}`);
					endGroup();

					startGroup('Model installation');
					info(`Creating folder and parent(s): ${this.modelDir}`);
					return mkdirP(this.modelDir)
						.then(() => info(`Created folder and parent(s): ${this.modelDir}`))
						.finally(() => endGroup());
				}),
			);
	}
}

await new PreCore().main();
