import GitHub from './GitHubAPI/GitHub';
import plugin from '../plugin.json';
import githubFs from './githubFs';

const prompt = acode.require('prompt');
const confirm = acode.require('confirm');
const pallete = acode.require('pallete');
const helpers = acode.require('helpers');
const multiPrompt = acode.require('multiPrompt');
const openFolder = acode.require('openFolder');
const EditorFile = acode.require('EditorFile');

if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(this);
    });
  };
}

class AcodePlugin {
  token = '';
  NEW = `${helpers.uuid()}_NEW`;
  #cacheFile;
  #fsInitialized = false;
  #repos = [];
  #gists = [];

  async init($page, cacheFile) {
    this.#cacheFile = cacheFile;
    this.commands.forEach(command => {
      editorManager.editor.commands.addCommand(command);
    });

    this.token = await this.#cacheFile.readFile('utf8');
    await this.initFs();
  }

  async initFs() {
    if (this.#fsInitialized) return;
    githubFs.remove();
    githubFs(this.getToken.bind(this));
    this.#fsInitialized = true;
  }

  async getToken() {
    if (this.token) return this.token;
    await this.updateToken();
    return this.token;
  }

  async destroy() {
    githubFs.remove();
    this.commands.forEach(command => {
      editorManager.editor.commands.removeCommand(command.name);
    });
  }

  async openRepo() {
    await this.initFs();
    this.token = await this.getToken();
    pallete(
      this.listRepositories.bind(this),
      this.selectBranch.bind(this),
      'Type to search repository',
    );
  }

  async selectBranch(repo) {
    const [user, repoName] = repo.split('/');
    pallete(
      this.listBranches.bind(this, user, repoName),
      (branch) => this.openRepoAsFolder(user, repoName, branch)
        .catch(helpers.error),
      'Type to search branch',
    );
  }

  async deleteGist() {
    await this.initFs();
    const gist = await new Promise((resolve) => {
      pallete(
        this.listGists.bind(this, false),
        resolve,
        'Type to search gist',
      );
    });
    const confirmation = await confirm(strings['warning'], 'Delete this gist?');
    if (!confirmation) return;

    const gh = await this.#GitHub();
    const gistApi = gh.getGist(gist);
    await gistApi.delete();
    this.#gists = this.#gists.filter(g => g.id !== gist);
    window.toast('Gist deleted');
  }

  async deleteGistFile() {
    await this.initFs();
    const gist = await new Promise((resolve) => {
      pallete(
        this.listGists.bind(this, false),
        resolve,
        'Type to search gist',
      );
    });

    const file = await new Promise((resolve) => {
      pallete(
        this.listGistFiles.bind(this, gist, false),
        resolve,
        'Type to search file',
      );
    });

    const confirmation = await confirm(strings['warning'], 'Delete this file?');
    if (!confirmation) return;

    const gh = await this.#GitHub();
    const gistApi = gh.getGist(gist);
    await gistApi.update({
      files: {
        [file]: null,
      },
    });
    const cachedGist = this.#getGist(gist);
    if (cachedGist) cachedGist.files = cachedGist.files.filter(f => f.filename !== file);
    window.toast('File deleted');
  }

  async openRepoAsFolder(user, repoName, branch) {
    const cachedRepo = this.#getRepo(user, repoName);
    if (branch === this.NEW) {
      const { from, branch: newBranch } = await multiPrompt(
        strings['create new branch'],
        [{
          id: 'from',
          placeholder: strings['use branch'],
          hints: (setHints) => {
            setHints(cachedRepo.branches);
          },
          type: 'text',
        },
        {
          id: 'branch',
          placeholder: strings['new branch'],
          type: 'text',
          match: /^[a-z\-_0-9]+$/i,
        }],
      );
      branch = newBranch;
      const gh = await this.#GitHub();
      const repo = gh.getRepo(user, repoName);
      await repo.createBranch(from, newBranch);
    }

    if (branch === '..') {
      this.openRepo();
      return;
    }

    const url = githubFs.constructUrl('repo', user, repoName, '/', branch);
    openFolder(url, {
      name: `${user}/${repoName}/${branch}`,
    });
  }

  async openGist() {
    await this.initFs();
    this.token = await this.getToken();

    pallete(
      this.listGists.bind(this),
      this.openGistFile.bind(this),
      'Type to search gist',
    );
  }

  async openGistFile(gist) {
    let url;
    let thisFilename;
    if (gist === this.NEW) {
      const { description, name, public: isPublic } = await multiPrompt(
        'New gist',
        [{
          id: 'description',
          placeholder: 'Description',
          type: 'text',
        },
        {
          id: 'name',
          placeholder: 'File name*',
          type: 'text',
          required: true,
        },
        [
          'Visibility',
          {
            id: 'public',
            name: 'visibility',
            value: true,
            placeholder: 'Public',
            type: 'radio',
          },
          {
            id: 'private',
            name: 'visibility',
            value: false,
            placeholder: 'Private',
            type: 'radio',
          }
        ]],
      ).catch(() => {
        window.toast(strings['cancelled']);
      });

      helpers.showTitleLoader();
      const gh = await this.#GitHub();
      const gist = gh.getGist();
      const { data } = await gist.create({
        description,
        public: isPublic,
        files: {
          [name]: {
            content: '# New gist',
          },
        },
      });
      this.#gists.push(this.#formatGist(data));
      thisFilename = name;
      url = githubFs.constructUrl('gist', data.id, name);
      helpers.removeTitleLoader();
    } else {
      await new Promise((resolve) => {
        pallete(
          this.listGistFiles.bind(this, gist),
          async (file) => {
            if (file === this.NEW) {
              const filename = await prompt('Enter file name', '', 'text', {
                required: true,
                placeholder: 'filename',
              });
              if (!filename) {
                window.toast(strings['cancelled']);
              }
              helpers.showTitleLoader();
              const gh = await this.#GitHub();
              await gh.getGist(gist).update({
                files: {
                  [filename]: {
                    content: '# New gist file',
                  },
                },
              });
              const cachedGist = this.#getGist(gist);
              cachedGist.files?.push({
                text: filename,
                value: filename,
              });
              helpers.removeTitleLoader();
              thisFilename = filename;
              url = githubFs.constructUrl('gist', gist, filename);
              resolve();
              return;
            }

            url = githubFs.constructUrl('gist', gist, file);
            thisFilename = file;
            resolve();
          },
          'Type to search gist file',
        );
      });
    }

    new EditorFile(thisFilename, {
      uri: url,
      render: true,
    });

  }

  async updateToken() {
    const result = await prompt('Enter github token', '', 'text', {
      required: true,
      placeholder: 'token',
    });

    if (result) {
      this.token = result;
      this.#fsInitialized = false;
      await this.#cacheFile.writeFile(result);
      await this.initFs();
    }
  }

  async listRepositories() {
    if (this.#repos.length) {
      return [...this.#repos];
    }
    const gh = await this.#GitHub();
    const user = gh.getUser();
    const repos = await user.listRepos();
    const { data } = repos;

    const list = data.map((repo) => {
      const { name, owner, visibility } = repo;
      return {
        text: `<div style="display: flex; flex-direction: column;">
        <strong data-str=${owner.login} style="font-size: 1rem;">${name}</strong>
        <span style="font-size: 0.8rem; opacity: 0.8;">${visibility}</span>
      <div>`,
        value: `${owner.login}/${name}`,
      }
    });
    this.#repos = [...list];
    return list;
  }

  async listBranches(user, repoName) {
    let list = [];
    const cachedRepo = this.#getRepo(user, repoName);
    if (cachedRepo && cachedRepo.branches) {
      list = [...cachedRepo.branches];
    } else {
      const gh = await this.#GitHub();
      const repo = gh.getRepo(user, repoName);
      const branches = await repo.listBranches();
      const { data } = branches;

      list = data.map((branch) => {
        return {
          text: branch.name,
          value: branch.name,
        }
      });

      if (cachedRepo) {
        cachedRepo.branches = [...list];
      }
    }

    list.push({
      text: 'New branch',
      value: this.NEW,
    });

    list.unshift({
      text: '..',
      value: '..',
    });

    return list;
  }

  async listGists(showAddNew = true) {
    let list = [];
    if (this.#gists.length) {
      list = [...this.#gists];
    } else {
      const gh = await this.#GitHub();
      const user = gh.getUser();
      const gists = await user.listGists();
      const { data } = gists;

      list = data.map(this.#formatGist);

      this.#gists = [...list];
    }

    if (showAddNew) {
      list.push({
        text: this.#highlitedText('New gist'),
        value: this.NEW,
      });
    }

    return list;
  }

  async listGistFiles(gistId, showAddNew = true) {
    let list = [];
    const cachedGist = this.#getGist(gistId);
    if (cachedGist && cachedGist.files) {
      list = [...cachedGist.files];
    } else {
      const gh = await this.#GitHub();
      const gist = gh.getGist(gistId);
      const { data: { files, owner } } = await gist.read();

      list = Object.values(files).map(({ filename }) => {
        return {
          text: filename,
          value: filename,
        }
      });

      if (cachedGist) {
        cachedGist.files = [...list];
      }
    }

    if (showAddNew) {
      list.push({
        text: this.#highlitedText('New file'),
        value: this.NEW,
      });
    }

    return list;
  }

  #highlitedText(text) {
    return `<span style='text-transform: uppercase; color: var(--popup-active-color)'>${text}</span>`;
  }

  #formatGist(gist) {
    const { description, owner, files } = gist;
    const file = Object.values(files)[0];
    return {
      text: `<div style="display: flex; flex-direction: column;">
    <strong data-str=${owner.login} style="font-size: 1rem;">${description || file.filename}</strong>
  <div>`,
      value: gist.id,
    }
  }

  #getRepo(user, repoName) {
    return this.#repos.find(repo => repo.value === `${user}/${repoName}`);
  }

  #getGist(gistId) {
    return this.#gists.find(gist => gist.value === gistId);
  }

  async #GitHub() {
    return new GitHub({ token: await this.getToken() });
  }

  get commands() {
    return [
      {
        name: 'github:repository:selectrepo',
        description: 'Open repository',
        exec: this.openRepo.bind(this),
      },
      {
        name: 'github:gist:opengist',
        description: 'Open gist',
        exec: this.openGist.bind(this),
      },
      {
        name: 'github:gist:deletegist',
        description: 'Delete gist',
        exec: this.deleteGist.bind(this),
      },
      {
        name: 'github:gist:deletegistfile',
        description: 'Delete gist file',
        exec: this.deleteGistFile.bind(this),
      },
      {
        name: 'github:updatetoken',
        description: 'Update github token',
        exec: this.updateToken.bind(this),
      },
      {
        name: 'github:clearcache',
        description: 'Clear github cache',
        exec: () => {
          this.#repos = [];
          this.#gists = [];
        }
      }
    ]
  }
}

if (window.acode) {
  const acodePlugin = new AcodePlugin();
  acode.setPluginInit(plugin.id, async (baseUrl, $page, { cacheFileUrl, cacheFile }) => {
    if (!baseUrl.endsWith('/')) {
      baseUrl += '/';
    }
    acodePlugin.baseUrl = baseUrl;
    await acodePlugin.init($page, cacheFile, cacheFileUrl);
  });
  acode.setPluginUnmount(plugin.id, () => {
    acodePlugin.destroy();
  });
}