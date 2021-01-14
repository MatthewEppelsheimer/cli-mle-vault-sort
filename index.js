#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const chalk = require( "chalk" );
const inquirer = require( "inquirer" );
const inquirerAutosubmitPrompt = require('inquirer-autosubmit-prompt');
const log = require("log-to-file");

const dryRun = process.argv.includes('--dry');

const pathJoinEscaped = (...fragments) => {
	return path.join(...fragments)
		.replace(/\s/g,"\\ ");
}

const logLocation = process.env.MLE_VAULT_SORT_LOG_PATH ||
	pathJoinEscaped(
		path.dirname(process.argv[1]),
		'logs',
		`log-${new Date(Date.now()).toISOString()}.txt`
	);

const currentWorkingDir = process.cwd();

// register plugin to add 'autosubmit' prompt type, to submit
// user input as soon as it is valid, saving them 'Enter' keystrokes
inquirer.registerPrompt('autosubmit',inquirerAutosubmitPrompt);

// Consistent, graceful exit
// Used more frequently in bad situations, so default to exit code of 1
const bailOut = (warning, exitCode = 1, showLogMessage) => {
	console.warn(warning);

	showLogMessage && console.log(`${chalk.blue("View the log for this run at:")} ${logLocation}`);

	process.exit(exitCode);
}

const prepareLogFile = () => {
	// If log directory doesn't exist, try to create it
	const dirPath = path.dirname(logLocation);
	try {
		fs.accessSync(dirPath, fs.constants.F_OK);
	} catch (err) {
		try {
			fs.mkdirSync(dirPath,{recursive: true}) // @TODO override default `options.mode` of 777
		} catch (err2) {
			bailOut(
				`${chalk.red("Unable to access or create log directory at path")} ${dirPath}. ${chalk.red(ABORTING)}`,
				1,
				false // squelch "log viewable at" message
			);
		}
	}

	// Create log file
	fs.writeFileSync(logLocation);
}

const getFiles = () => {
	return fs.readdirSync(currentWorkingDir,{withFileTypes: true})
		.filter(entry => entry.isFile())
		.map((entry) => entry.name);
};

const logCommand = (command) => {
	log(command,logLocation);
}

const runCommand = (command) => {
	try {
		execSync(command);
		logCommand(command);
	 } catch (e) {
		 bailOut(`ERROR: ${e}`);
	 }
}

const moveFile = (filename, relativeTargetDir) => {
	const oldPath = pathJoinEscaped(currentWorkingDir,filename);
	const newDir = pathJoinEscaped(currentWorkingDir,relativeTargetDir);
	const newPath = pathJoinEscaped(currentWorkingDir,relativeTargetDir,filename);

	// use more explicit newPath even though newDir would do
	// to persist information needed for undo
	const command = `mv ${oldPath} ${newPath}`
	if (dryRun) {
		console.log(chalk.yellow(`[DRY RUN]!`));
	} else {
		runCommand(command);
	}

	const message = `${chalk.green("Moved")} ${chalk.blue(filename)} from ${chalk.blue(currentWorkingDir)} to ${chalk.blueBright(newDir)}`;
	console.log(message);

	return {
		oldPath,
		newPath
	};
};

const sortFile = async (fileName) => {

	const choices = ['a','p','g','d','s','u'];

	const question = {
		name: 'action',
		type: 'autosubmit',
		choices,
		message: '[P]rivate, [G]eneral, [D]efer, [S]kip, [U]ndo, or [A]bort (default)',
		default: 'A',
		autoSubmit: (input) => input.length && choices.includes( input.toLowerCase() ),
		validate: (input) => choices.includes( input.toLowerCase() )
	};

	const message = `\n\nFor file: ${fileName}...`;
	console.log(chalk.green(message));

	const answer = await inquirer.prompt( question );

	switch (answer.action.toLowerCase()) {
		case 'a':
			return 'abort';

		case 'd':
			return moveFile(fileName,'../defer/');

		case 'g':
			return moveFile(fileName,'../general/');

		case 'p':
			return moveFile(fileName,'../private/');

		case 's':
			return 'skip';

		case 'u':
			return 'undo';

		default:
			bailOut(chalk.red(`Very unlikely error: invalid answer.action value: ${answer.action}`));
	}
}

const undo = (info) => {
	const {	oldPath,newPath } = info;

	const command = `mv ${newPath} ${oldPath}`;
	if (dryRun) {
		console.log(chalk.green(`[DRY RUN]: ${command}`));
	} else {
		runCommand(command);
	}
}

const main = async () => {
	prepareLogFile();

	const files = getFiles();

	let undoInfo;

	for (let i = 0; i < files.length; i++) {
		const result = await sortFile(files[i]);


		if ('skip' === result) {
			continue;
		}

		if ('abort' === result) {
			bailOut(
				`Aborting after moving ${i} files. Re-run to continue sorting ${files.length - i} additional files.`,
				0
			);
		}

		else if ('undo' === result) {
			if (undoInfo) {
				const message = `Undoing last change.`;
				console.log(chalk.green(message));

				undo(undoInfo);

				bailOut(
					`Exiting after moving ${i} files. Re-run to continue sorting ${files.length - i} additional files.`,
					0
				);
			} else {
				const message = `Nothing to undo.`;
				console.log(chalk.yellow(message));

				// since this is a no-op, re-run the loop for this file
				i--;
			}

		} else {
			// store what we just did to set up for undo as next sort file action
			undoInfo = result;
		}
	}

	console.log(chalk.green(`All done, after moving ${files.length} files.`));
};

main();
