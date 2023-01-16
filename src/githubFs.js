import GitHub from './GitHubAPI/GitHub';
import { lookup } from 'mime-types';

const fsOperation = acode.require('fsoperation');
const Url = acode.require('url');
const helpers = acode.require('helpers');
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

export default function githubFs(token) {

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
   * 
   * @param {string} user 
   * @param {string} repoAtBranch 
   * @param {string} path 
   * @returns 
   */
  function readRepo(user, repoAtBranch, path) {
    const gh = new GitHub({ token });
    const [repoName, branch] = repoAtBranch.split('@');
    const repo = gh.getRepo(user, repoName);
    let sha = '';
    const getSha = async () => {
      if (!sha) {
        const res = await repo.getSha(branch, path);
        sha = res.data.sha;
      }
    };

    return {
      async lsDir() {
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
        await getSha();
        let { data } = await repo.getBlob(sha, 'blob');
        data = await data.arrayBuffer();

        // const textEncoder = new TextEncoder();
        // data = textEncoder.encode(window.atob(data));

        if (encoding) {
          return helpers.decodeText(data, encoding);
        }

        return data;
      },
      async writeFile(data) {
        await repo.writeFile(branch, path, data, `update ${path}`);
      },
      async createFile(name, data = '') {
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

        await repo.writeFile(branch, newPath, data, `create ${newPath}`);
        return githubFs.constructUrl('repo', user, repoName, newPath, branch);
      },
      async createDirectory(dirname) {
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
        await repo.writeFile(branch, createPath, '', `create ${newPath}`);
        return githubFs.constructUrl('repo', user, repoName, newPath, branch);
      },
      async copyTo(dest) {
        throw new Error('Not implemented');
      },
      async delete() {
        await getSha();
        await repo.deleteFile(branch, path, `delete ${path}`, sha);
      },
      async moveTo(dest) {
        throw new Error('Not implemented');
      },
      async renameTo(name) {
        // rename file
        await getSha();
        await repo.move(branch, path, name, 'rename file', sha);
      },
      async exists() {
        try {
          await repo.getSha(branch, path);
          return true;
        } catch (e) {
          return false;
        }
      },
      async stat() {
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
    const gh = new GitHub({ token });
    const gist = gh.getGist(gistId);
    const getFile = async () => {
      if (!file) {
        const { data } = await gist.read();
        file = data.files[path];
      }
      return file;
    }
    return {
      async lsDir() {
        throw new Error('Not implemented');
      },
      async readFile(encoding, progress) {
        let { content: data } = await getFile();
        const textEncoder = new TextEncoder();
        data = textEncoder.encode(file.content);

        if (encoding) {
          return helpers.decodeText(data, encoding);
        }

        return data;
      },
      async writeFile(data) {
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
        return !!await getFile();
      },
      async stat() {
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
