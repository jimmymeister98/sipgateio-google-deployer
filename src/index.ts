import inquirer, { Answers, Question, QuestionCollection } from 'inquirer';
import inquirerAutocompletePrompt from 'inquirer-autocomplete-prompt';

const githubProjectNames = [
  'sipgateio-incomingcall-node',
  'sipgateio-incomingcall-python',
  'sipgateio-sendsms-node',
].sort();

inquirer.registerPrompt('autocomplete', inquirerAutocompletePrompt);

const fetchEnvFor = async (project: string) => {
  const data = await fetch(
    new URL(
      `https://raw.githubusercontent.com/sipgate-io/${project}/HEAD/.env.example`,
    ),
  );
  return data.text();
};

function composeQuestion(line: string, comment: string) {
  const envName = line.slice(0, line.indexOf('=')).trim();
  const envDefaultValue =
    line
      .slice(line.indexOf('=') + 1, line.length)
      .trim()
      .match(/[^'"]+/gm) ?? '';
  return {
    prefix: `${comment}\x1B[36m\u2699\x1B[0m`,
    name: `${envName}`,
    message: `${envName} =`,
    type: 'input',
    default: envDefaultValue.length > 0 ? envDefaultValue : undefined,
  };
}

function extractQuestions(envArray: string[]) {
  // lots of side effect, more than one responsibility
  let comment = '';
  const envQuestions: Question[] = [];

  envArray.forEach((line: string) => {
    if (line.startsWith('#')) {
      // line is a comment
      comment += `INFO: ${line
        .slice(line.indexOf('#') + 1, line.length)
        .trim()} \n`;
      return;
    }
    envQuestions.push(composeQuestion(line, comment));
    comment = '';
  });
  return envQuestions;
}

const startCLI = async () => {
  const selectedProjectAnswers: { selectedProject: string } =
    await inquirer.prompt([
      {
        name: 'selectedProject',
        message: 'Choose an sipgate-io example:',
        type: 'autocomplete',
        source: (answersSoFor: string[], input: string | undefined) =>
          githubProjectNames.filter((projects) =>
            projects.includes(input ?? ''),
          ),
      },
    ]);

  console.log(
    `Das Projekt: ${selectedProjectAnswers.selectedProject} wurde ausgewählt!`,
  );

  const env = await fetchEnvFor(selectedProjectAnswers.selectedProject);

  const envArray = env
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const envQuestions: Question[] = extractQuestions(envArray);
  const envVarValues = await inquirer.prompt(
    envQuestions as QuestionCollection,
  );

  console.log(envVarValues);
};

startCLI();
