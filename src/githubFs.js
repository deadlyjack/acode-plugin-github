import GitHub from './GitHubAPI/GitHub';
import { lookup } from 'mime-types';

const fsOperation = acode.require('fsoperation');
const Url = acode.require('url');
const helpers = acode.require('helpers');
const prompt = acode.require('prompt');
const test = (url) => /^gh:/.test(url);

githubFs.remove = () => {
  fsOperation.remove(test);
};

/**
 * 
 * @param {string} user 
 * @param {'repo' | 'gist'} type 
 * @param {string} repo 
 * @param {string} path 
 * @param {string} branch 
 * @returns 
 */
githubFs.constructUrl = (type, user, repo, path, branch) => {
  if (type === 'gist') {
    // user is gist id
    // repo is filename
    return `gh://gist/${user}/${repo}`;
  }
  let url = `gh://${type}/${user}/${repo}`;
  if (branch) {
    url += `@${branch}`;
  }
  if (path) {
    url = Url.join(url, path);
  }
  return url;
};

export default function githubFs(token, settings) {
  fsOperation.extend(test, (url) => {
    const { user, type, repo, path, gist } = parseUrl(url);
    if (type === 'repo') {
      return readRepo(user, repo, path);
    }

    if (type === 'gist') {
      return readGist(gist, path);
    }

    throw new Error('Invalid github url');
  });

  /**
   * Parse url to get type, user, repo and path
   * @param {string} url 
   */
  function parseUrl(url) {
    url = url.replace(/^gh:\/\//, '');
    const [type, user, repo, ...path] = url.split('/');

    // gist doesn't have user
    if (type === 'gist') {
      return {
        /**@type {string} */
        gist: user,
        /**@type {string} */
        path: repo,
        type: 'gist',
      }
    }

    return {
      /**@type {string} */
      user,
      /**@type {'repo'|'gist'} */
      type,
      /**@type {string} */
      repo,
      /**@type {string} */
      path: path.join('/'),
    };
  }

  /**
   * Get commit message from user
   * @param {string} message 
   * @returns 
   */
  async function getCommitMessage(message) {
    if (settings.askCommitMessage) {
      const res = await prompt('Commit message', message, 'text');
      if (!res) {
        const error = new Error('Commit aborted');
        error.code = 0;
        error.toString = () => error.message;
        throw error;
      }
      return res;
    }
    return message;
  }

  /**
   * 
   * @param {string} user 
   * @param {string} repoAtBranch 
   * @param {string} path 
   * @returns 
   */
  function readRepo(user, repoAtBranch, path) {
    let gh;
    let repo;
    const [repoName, branch] = repoAtBranch.split('@');
    let sha = '';
    const getSha = async () => {
      if (!sha && path) {
        const res = await repo.getSha(branch, path);
        sha = res.data.sha;
      }
    };

    const init = async () => {
      if (gh) return;
      gh = new GitHub({ token: await token() });
      repo = gh.getRepo(user, repoName);
    }

    const move = async (dest) => {
      const newUrl = githubFs.constructUrl('repo', user, repoName, dest, branch);
      if (dest === path) return newUrl;
      if (dest.startsWith('/')) dest = dest.slice(1);
      await repo.move(branch, path, dest);
      return newUrl;
    }

    return {
      async lsDir() {
        await init();
        const res = await repo.getSha(branch, path);
        const { data } = res;

        return data.map(({ name: filename, path, type }) => {
          return {
            name: filename,
            isDirectory: type === 'dir',
            isFile: type === 'file',
            url: githubFs.constructUrl('repo', user, repoName, path, branch),
          }
        });
      },
      async readFile(encoding) {
        if (!path) throw new Error('Cannot read root directory')
        await init();
        await getSha();
        let { data } = await repo.getBlob(sha, 'blob');
        data = await data.arrayBuffer();

        if (encoding) {
          return helpers.decodeText(data, encoding);
        }

        return data;
      },
      async writeFile(data) {
        if (!path) throw new Error('Cannot write to root directory')
        const commitMessage = await getCommitMessage(`update ${path}`);
        if (!commitMessage) return;
        await init();
        await repo.writeFile(branch, path, data, commitMessage);
      },
      async createFile(name, data = '') {
        await init();
        const newPath = path === '' ? name : Url.join(path, name);
        // check if file exists
        let sha;
        try {
          sha = await repo.getSha(branch, newPath);
        } catch (e) {
          // file doesn't exist
        }

        if (sha) {
          throw new Error('File already exists');
        }

        const commitMessage = await getCommitMessage(`create ${newPath}`);
        if (!commitMessage) return;
        await repo.writeFile(branch, newPath, data, commitMessage);
        return githubFs.constructUrl('repo', user, repoName, newPath, branch);
      },
      async createDirectory(dirname) {
        await init();
        let newPath = path === '' ? dirname : Url.join(path, dirname);
        // check if file exists
        let sha;
        try {
          sha = await repo.getSha(branch, newPath);
        } catch (e) {
          // file doesn't exist
        }

        if (sha) {
          throw new Error('Directory already exists');
        }

        const createPath = Url.join(newPath, '.gitkeep');
        const commitMessage = await getCommitMessage(`create ${newPath}`);
        if (!commitMessage) return;
        await repo.writeFile(branch, createPath, '', commitMessage);
        return githubFs.constructUrl('repo', user, repoName, newPath, branch);
      },
      async copyTo(dest) {
        throw new Error('Not implemented');
      },
      async delete() {
        if (!path) throw new Error('Cannot delete root');
        await init();
        await getSha();
        const commitMessage = await getCommitMessage(`delete ${path}`);
        if (!commitMessage) return;
        await repo.deleteFile(branch, path, commitMessage, sha);
      },
      async moveTo(dest) {
        if (!path) throw new Error('Cannot move root');
        await init();
        const { path: destPath } = parseUrl(dest);
        const newName = Url.join(destPath, Url.basename(path));
        const res = await move(newName);
        return res;
      },
      async renameTo(name) {
        if (!path) throw new Error('Cannot rename root');
        await init();
        const newName = Url.join(Url.dirname(path), name);
        const res = await move(newName);
        return res;
      },
      async exists() {
        if (!path) return true;
        await init();
        try {
          await repo.getSha(branch, path);
          return true;
        } catch (e) {
          return false;
        }
      },
      async stat() {
        if (!path) {
          return {
            length: 0,
            name: `github/${user}/${repoName}`,
            isDirectory: true,
            isFile: false,
          }
        }
        await init();
        await getSha();
        const content = await repo.getBlob(sha);
        return {
          length: content.data.length,
          name: path.split('/').pop(),
          isDirectory: path.endsWith('/'),
          isFile: !path.endsWith('/'),
          type: lookup(path),
        };
      },
    }
  }

  function readGist(gistId, path) {
    let file;
    let gh;
    let gist;
    const getFile = async () => {
      if (!file) {
        const { data } = await gist.read();
        file = data.files[path];
      }
      return file;
    }
    const init = async () => {
      if (gh) return;
      gh = new GitHub({ token: await token() });
      gist = gh.getGist(gistId);
    }

    return {
      async lsDir() {
        throw new Error('Not implemented');
      },
      async readFile(encoding, progress) {
        await init();
        let { content: data } = await getFile();
        const textEncoder = new TextEncoder();
        data = textEncoder.encode(file.content);

        if (encoding) {
          return helpers.decodeText(data, encoding);
        }

        return data;
      },
      async writeFile(data) {
        await init();
        await gist.update({
          files: {
            [path]: {
              content: data,
            }
          }
        });
      },
      async createFile(name, data) {
        throw new Error('Not implemented');
      },
      async createDirectory() {
        throw new Error('Not implemented');
      },
      async copyTo() {
        throw new Error('Not implemented');
      },
      async delete() {
        throw new Error('Not implemented');
      },
      async moveTo() {
        throw new Error('Not implemented');
      },
      async renameTo() {
        throw new Error('Not implemented');
      },
      async exists() {
        await init();
        return !!await getFile();
      },
      async stat() {
        await init();
        await getFile();
        return {
          length: file.size,
          name: path,
          isDirectory: false,
          isFile: true,
          type: lookup(path),
        };
      },
    }
  }
}
