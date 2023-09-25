import { exec } from 'child_process';
import inquirer, { QuestionCollection } from 'inquirer';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { promisify } from 'util';
import { COLOR_YELLOW, COLOR_DEFAULT, COLOR_GRAY } from './constants';
import { getProjectList, readExampleConfig } from './fetch';
import { Config } from './types';
import { buildEnv, calculateTabs, extractQuestions } from './utils';

const execCommand = promisify(exec);

export function extractEnv(line: string) {
  const envName = line.slice(0, line.indexOf('=')).trim();
  const envValue = line
    .slice(line.indexOf('=') + 1, line.length)
    .trim()
    .match(/[^'"]+/gm);

  return {
    envName,
    envValue,
  };
}

export function logUsedConfig(key: string, value?: string) {
  console.log(`Using ${key}=${value ?? '*********'} from config file.`);
}

export function configExists(configPath: string): boolean {
  return existsSync(configPath);
}

export function loadConfig(configPath?: string): Config {
  const actualConfigPath = configPath ?? './config.cfg';

  const content = readFileSync(actualConfigPath, { encoding: 'utf-8' });
  const cfgObj: Config = {};

  content
    .split('\n')
    .filter((line) => !line.startsWith('#') && line.trim() !== '')
    .forEach((line) => {
      const { envName, envValue } = extractEnv(line);
      cfgObj[envName] = envValue?.[0] ?? '';
    });

  console.log(`Loaded config from ${actualConfigPath} successfully`);
  return cfgObj;
}

export async function interactivelyGenerateConfig(): Promise<Config> {
  const envArray = readExampleConfig();
  const envQuestions = extractQuestions(envArray);

  const envVarValues = await inquirer.prompt(
    envQuestions as QuestionCollection,
  );

  const { filename } = await inquirer.prompt([
    {
      name: 'filename',
      message: 'Please choose a name for your file: ',
      type: 'input',
      default: 'config',
    },
  ]);

  const { confirm } = await inquirer.prompt([
    {
      name: 'confirm',
      message: 'Are you sure everything is correct?',
      type: 'confirm',
    },
  ]);

  if (!confirm) {
    return interactivelyGenerateConfig();
  }

  if (configExists(`./${filename}.cfg`)) {
    const { confirmoverwrite } = await inquirer.prompt([
      {
        name: 'confirmoverwrite',
        message: `${filename} already exists, are you sure you want to overwrite?`,
        type: 'confirm',
      },
    ]);

    if (confirmoverwrite) {
      writeFileSync(`./${filename}.cfg`, buildEnv(envVarValues));
    } else {
      console.warn(`${COLOR_YELLOW}[WARN] Aborting...${COLOR_DEFAULT}`);
      return interactivelyGenerateConfig();
    }
  }

  if (!confirm) {
    return interactivelyGenerateConfig();
  }
  writeFileSync(`./${filename}.cfg`, buildEnv(envVarValues));

  const resultConfig: Config = {};
  Object.entries(envVarValues).forEach(([key, value]) => {
    // eslint-disable-next-line prefer-destructuring
    if (Array.isArray(value)) resultConfig[key] = value[0];
    else resultConfig[key] = value;
  });

  return resultConfig;
}

function generateRandomGcpProjectId(): string {
  const prefix = 'sipgateio-';
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const projectIdLength = 30 - prefix.length;

  const randomChars = [];
  for (let i = 0; i < projectIdLength; i += 1) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    randomChars.push(characters[randomIndex]);
  }

  return prefix + randomChars.join('');
}

export async function createGoogleCloudProject(name: string) {
  try {
    const projectId = generateRandomGcpProjectId();
    console.log(
      `Creating new GCP project with the name: ${name} and the project ID: ${projectId}...`,
    );
    await execCommand(`gcloud projects create ${projectId} --name="${name}"`);
    return true;
  } catch (error) {
    console.error(
      `Could not create GCP project. Please check if the project ID is (globally) unique and valid.`,
    );
    return false;
  }
}

export async function selectGoogleCloudProject(config: Config) {
  console.log('Fetching Google Cloud projects...');
  const { stdout } = await execCommand(
    `gcloud projects list --format="value(projectId)"`,
  );
  const projectName = config.GOOGLE_PROJECT_NAME?.trim();
  const isValidProjectName =
    stdout.includes(projectName ?? '') &&
    !projectName?.match(/(^|\/)\.\.($|\/)/);

  const gcloudSetProject = async (name: string) => {
    await execCommand(`gcloud config set project ${name}`);
    console.warn(
        `${COLOR_YELLOW}[WARN] Important: Check if Cloud Build API is enabled for ${name}${COLOR_DEFAULT}`,
    );
    return name;
  };

  if (projectName && isValidProjectName) {
    logUsedConfig('GOOGLE_PROJECT_NAME', projectName);

    return gcloudSetProject(projectName);
  }

  if (!isValidProjectName) {
    console.warn(
      `${COLOR_YELLOW}[WARN] Invalid GOOGLE_PROJECT_NAME=${projectName} in config.${COLOR_DEFAULT}`,
    );
  }

  const { selectedProject } = await inquirer.prompt([
    {
      name: 'selectedProject',
      message:
        'Choose a GCP project for this example or enter a new name to generate one:',
      type: 'autocomplete',
      validate: (input) => {
        if (input.trim() === '') return 'Project name cannot be empty';
        return true;
      },
      suggestOnly: true,
      source: (answersSoFor: string[], input: string | undefined) =>
        stdout
          .split('\n')
          .filter(
            (name) =>
              name.toLowerCase().includes(input?.toLowerCase() ?? '') &&
              name !== '',
          ),
    },
  ]);
  if (!stdout.includes(selectedProject)) {
    const creationSuccess = await createGoogleCloudProject(selectedProject);
    if (!creationSuccess) {
      throw new Error('Failed to create a new GCP project.');
    }
  }

  return gcloudSetProject(selectedProject);
}

export async function selectSipgateIOProject(config: Config) {
  let githubProjects = await getProjectList();

  const projectName = config.EXAMPLE_REPO_NAME?.trim();
  const isValidProjectName =
    !projectName || githubProjects.find((x) => x.repository === projectName);

  if (projectName && isValidProjectName) {
    logUsedConfig('EXAMPLE_REPO_NAME', projectName);
    return projectName;
  }

  if (!isValidProjectName) {
    console.warn(
      `${COLOR_YELLOW}[WARN] Invalid EXAMPLE_REPO_NAME=${projectName} in config.${COLOR_DEFAULT}`,
    );
  }

  const tabs = calculateTabs(
    githubProjects.map((project) => project.repository),
  );

  githubProjects = githubProjects.map((project, index) => ({
    ...project,
    tabOffset: tabs[index],
  }));

  const { selectedProject } = await inquirer.prompt([
    {
      name: 'selectedProject',
      message: 'Choose a sipgate.io example:',
      type: 'autocomplete',
      source: (answersSoFor: string[], input: string | undefined) =>
        githubProjects
          .filter(
            (project) =>
              project.repository
                .toLowerCase()
                .includes(input?.toLowerCase() ?? '') ||
              project.description
                .toLowerCase()
                .includes(input?.toLowerCase() ?? ''),
          )
          .map(
            (project) =>
              `${project.repository}${'\t'.repeat(
                project.tabOffset ?? 1,
              )}${COLOR_GRAY} - ${
                project.description !== 'null'
                  ? `${project.description.slice(0, 101)}${
                      project.description.length > 101 ? '...' : ''
                    }`
                  : ``
              }${COLOR_DEFAULT}`,
          ),
    },
  ]);

  return selectedProject.slice(0, selectedProject.indexOf('\t')).trim();
}

export async function selectLocalProject() {
  const response = await inquirer.prompt([
    {
      name: 'repoPath',
      message: 'Please choose the path to your local repository: ',
    },
  ]);

  const cleanedPath = response.repoPath.replace(/\/$/, '');

  if (!existsSync(cleanedPath)) {
    console.warn(`${COLOR_YELLOW}[WARN] Please choose an existing Path.`);
    await selectLocalProject();
  }

  if (!existsSync(`${cleanedPath}/app.yaml`)) {
    console.log(
      'Invalid Repository. Please select a path which contains an app.yaml config file.',
    );
    await selectLocalProject();
  }

  return cleanedPath;
}

export async function selectGCPRegion(config: Config) {
  console.log('Fetching Google Cloud regions...');
  const { stdout } = await execCommand(
    `gcloud app regions list --format="value(region)"`,
  );
  let region = config.GOOGLE_PROJECT_REGION;
  const isInvalidRegion = !stdout.includes(region ?? '');
  if (region === '' || region === undefined || isInvalidRegion) {
    if (isInvalidRegion) {
      console.warn(
        `${COLOR_YELLOW}[WARN] Invalid GOOGLE_PROJECT_REGION=${region} in config.${COLOR_DEFAULT}`,
      );
    }
    const res = await inquirer.prompt([
      {
        name: 'selectedRegion',
        message: 'Choose a region for your GCP App Engine application:',
        type: 'autocomplete',
        source: (answersSoFor: string[], input: string | undefined) =>
          stdout
            .split('\n')
            .filter((name) =>
              name.toLowerCase().includes(input?.toLowerCase() ?? ''),
            ),
      },
    ]);
    region = res.selectedRegion;
  } else {
    logUsedConfig('GOOGLE_PROJECT_REGION', region);
  }
  return region;
}
