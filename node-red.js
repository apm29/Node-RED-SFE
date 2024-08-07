const http = require('http');
const express = require('express');
const RED = require('node-red');
const { existsSync } = require('fs');
const { join, dirname } = require('path');
const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { combine, timestamp, printf } = format;
// const nrRuntimeSettings = require('./settings');
const sharp = require('sharp')
/* ------  Don't mess with anything below - unless you're a nerd ;-) ------ */

const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const args = yargs(hideBin(process.argv))
	.option('port', {
		default: 11880,
		description: 'NodeRed监听端口',
		type: 'number'
	})
	.option('debug', {
		default: false,
		description: 'debug模式',
		type: 'boolean'
	})
	.option('settings', {
		description: 'NodeRed配置',
		type: 'string',
		demandOption: false,
		default: JSON.stringify({
			httpAdminRoot: "/",
			httpNodeRoot: "/api",
			userDir: "./.node-red",
			adminAuth: {
				type: "credentials",
				users: [
					{
						username: "zqt",
						password: "$2b$08$jktTdNysaZChBEP8EX4AIe4JvQRe4gGSuKWDjU4rl64DJ7GwQ4pMq",
						permissions: ["*"],
					},
					{
						username: "guest",
						password: "$2b$08$e2jbqJs8PiCRHkWf70CUruMasYlOFO4AnzL.4tCz8Ogv0OdXzCZeG",
						permissions: ["read"]
					},
				],
				default: {
					permissions: []
				}
			},
			logging: {
				console: {
					level: "info",
				}
			},
			runtimeState: {
				enabled: true
			},
			functionGlobalContext: {}
		})
	})
	.parseSync();

const nrSettings = function () {
	try {
		return JSON.parse(args.settings)
	} catch (error) {
		console.error(error);
		return {}
	}
}()

const pathPrefix = process.platform === 'win32' ? 'c:/' : '/';

const logFormat = printf(({ level, message, label, timestamp }) => {
	switch (typeof message) {
		case 'object':
			message = JSON.stringify(message);
			break;
	}
	return `[${timestamp}] ${level}\t${label?.padEnd(23, ' ')}: ${message}`;
});

const consoleLogger = createLogger({
	format: combine(
		format.colorize(),
		timestamp({ format: 'YYYY-MM-DD hh:mm:ss' }),
		logFormat
	),
	transports: [new transports.Console()]
});

let flowLogger;

if (process.pkg !== undefined) {
	const transport = new DailyRotateFile({
		filename: join(nrSettings.userDir ?? process.argv0, 'sfe-%DATE%.log'),
		datePattern: 'YYYY-MM-DD-HH',
		zippedArchive: true,
		maxSize: '20m',
		maxFiles: '7d'
	});

	flowLogger = createLogger({
		format: combine(timestamp({ format: 'YYYY-MM-DD hh:mm:ss' }), logFormat),
		transports: [transport]
	});
}

// In develop mode?
const develop = process.argv[2] === '--develop';

// The embedded path of the userDir (don't mess)
const ns = '{SFE_PROJECT_DIR}';
const userDir = 'NRUserDir';
const userDirPath = `${pathPrefix}snapshot/${ns}/build/${userDir}`;

// File exists?
const checkFileExists = (path) => {
	return existsSync(path);
};

const isEmbedded = checkFileExists(userDirPath);

// Get userDir
const getUserDir = () => {
	if (develop) {
		return join(__dirname, userDir);
	}

	if (process.pkg !== undefined) {
		if (isEmbedded) {
			return userDirPath;
		} else {
			return join(dirname(process.argv0), userDir);
		}
	}
};



// Node-RED log
const nrLog = (level, label, message) => {
	if (process.pkg !== undefined && flowLogger !== undefined) {
		flowLogger.log({ level, label: label, message });
	}
	consoleLogger.log({ level, label: `FLOW:${label}`, message });
};

// Main
const run = async () => {
	console.clear();
	consoleLogger.info({ label: 'Node Version', message: process.versions.node });
	const app = express();
	const server = http.createServer(app);

	// delete nrRuntimeSettings.userDir;
	// delete nrRuntimeSettings.logging;
	// delete nrRuntimeSettings.editorTheme;
	// delete nrRuntimeSettings.readOnly;
	// delete nrRuntimeSettings.contextStorage.file.config?.dir;


	// const nrSettings = {
	// 	userDir: getUserDir(),
	// 	logging: {
	// 		console: {
	// 			level: 'off',
	// 			metrics: false,
	// 			audit: false
	// 		}
	// 	},
	// 	editorTheme: {
	// 		header: {
	// 			title: `Node-RED SFE ${develop ? '[Design Time]' : '[Run Time]'}`
	// 		},
	// 		page: {
	// 			title: `Node-RED SFE ${develop ? '[Design Time]' : '[Run Time]'}`
	// 		},
	// 		projects: {
	// 			enabled: false
	// 		},
	// 		tours: false
	// 	},
	// 	...nrRuntimeSettings
	// };

	if (!nrSettings.functionGlobalContext) {
		nrSettings.functionGlobalContext = {};
	}
	if (!nrSettings.editorTheme) {
		nrSettings.editorTheme = {};
	}
	nrSettings.functionGlobalContext.SFELOG = nrLog;
	nrSettings.functionGlobalContext.sharp = sharp;

	if (develop) {
		nrSettings.disableEditor = false;
	}

	if (isEmbedded) {
		nrSettings.editorTheme.header.image = `${pathPrefix}snapshot/${ns}/build/resources/node-red.png`;
		nrSettings.editorTheme.page.css = `${pathPrefix}snapshot/${ns}/build/resources/sfe.css`;
		nrSettings.readOnly = true;

		nrSettings.editorTheme.login = {
			image: `${pathPrefix}snapshot/${ns}/build/resources/node-red-256-embedded.png`
		};

		/* Re-configure file context store */
		// if (nrSettings.contextStorage.file.config === undefined) {
		// 	nrSettings.contextStorage.file.config = {};
		// }
		// nrSettings.contextStorage.file.config.dir = join(
		// 	dirname(process.argv0),
		// 	'./'
		// );
	} else {
		nrSettings.editorTheme.login = {
			image: `${pathPrefix}snapshot/${ns}/build/resources/node-red-256-external.png`
		};
	}

	// Initialize Node-RED with the given settings
	RED.init(server, nrSettings);
	app.use(nrSettings.httpAdminRoot, RED.httpAdmin);
	app.use(nrSettings.httpNodeRoot, RED.httpNode);

	consoleLogger.info({
		label: 'Node-RED Version',
		message: RED.settings.version
	});
	consoleLogger.info({
		label: 'Mode',
		message: develop
			? 'Design Time'
			: isEmbedded
				? 'Run Time (Embedded)'
				: 'Run Time'
	});
	consoleLogger.info({ label: 'Namespace', message: ns });
	consoleLogger.info({
		label: 'Embedded UserDir Found',
		message: isEmbedded.toString()
	});
	consoleLogger.info({ label: 'UserDir', message: nrSettings.userDir });
	consoleLogger.info({ label: 'Flow File', message: nrSettings.flowFile });
	consoleLogger.info({
		label: 'UI Enabled',
		message: (!nrSettings.disableEditor).toString()
	});

	// Start the HTTP server

	server.on('error', (e) => {
		consoleLogger.error({
			label: 'Could Not Start Server',
			message: e.message
		});
	});
	server.on('listening', (e) => {
		RED.start()
			.catch((err) => {
				consoleLogger.error({ label: 'Could not start', message: err.message });
			})
			.then(() => {
				if (!nrSettings.disableEditor) {
					consoleLogger.info({
						label: 'UI Endpoint',
						message: `http://127.0.0.1:${args.port}${nrSettings.httpAdminRoot}`
					});
					consoleLogger.info({
						label: 'NodeRed Service',
						message: `NodeRed服务已启动@AUTOPADDLE`
					});
					if (process.send) {
						process.send("NodeRed服务已启动@AUTOPADDLE");
					}
				}
			});
	});
	server.listen(args.port);
};

// Run the main function and handle any errors
run().catch((err) => {
	consoleLogger.error({ label: 'Could not start', message: err.message });
	process.exit(1);
});
