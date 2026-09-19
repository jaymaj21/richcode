#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const net = require('node:net');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_TIMEOUT_MS = 30000;

function usage() {
    return [
        'Usage:',
        '  node cmd_client.js <port> -c <command>',
        '  node cmd_client.js <port> -f <filename>',
        '',
        'Options:',
        '  -c, --command   Send the supplied command string.',
        '  -f, --file      Read and send a UTF-8 command file.',
        '  -h, --help      Show this help.',
        '',
        'Examples:',
        '  node cmd_client.js 32123 -c "getIndex()"',
        '  node cmd_client.js 32123 -f command.js'
    ].join('\n');
}

function parseArgs(argv) {
    if (argv.includes('-h') || argv.includes('--help')) {
        return { help: true };
    }
    if (argv.length !== 3) {
        throw new Error('Expected a port followed by exactly one -c command or -f filename.');
    }

    const port = Number(argv[0]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Port must be an integer from 1 to 65535.');
    }

    const mode = argv[1];
    const value = argv[2];
    if (mode !== '-c' && mode !== '--command' && mode !== '-f' && mode !== '--file') {
        throw new Error(`Unknown input option: ${mode}`);
    }
    if (!value) {
        throw new Error(`${mode} requires a value.`);
    }

    return { port, mode, value };
}

function readCommand(options) {
    if (options.mode === '-f' || options.mode === '--file') {
        return fs.readFileSync(options.value, 'utf8');
    }
    return options.value;
}

function sendCommand({ host = DEFAULT_HOST, port, command, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    return new Promise((resolve, reject) => {
        if (command.includes('\0')) {
            reject(new Error('The command contains a NUL byte, which is reserved as the protocol delimiter.'));
            return;
        }

        const socket = net.createConnection({ host, port });
        let response = Buffer.alloc(0);
        let settled = false;

        function finish(error, value) {
            if (settled) return;
            settled = true;
            socket.destroy();
            if (error) reject(error);
            else resolve(value);
        }

        socket.setTimeout(timeoutMs);
        socket.once('connect', () => {
            socket.write(Buffer.concat([
                Buffer.from(command, 'utf8'),
                Buffer.from([0])
            ]));
        });
        socket.on('data', chunk => {
            response = Buffer.concat([response, chunk]);
            const delimiter = response.indexOf(0);
            if (delimiter !== -1) {
                finish(null, response.subarray(0, delimiter).toString('utf8'));
            }
        });
        socket.once('timeout', () => {
            finish(new Error(`Timed out after ${timeoutMs} ms waiting for a response.`));
        });
        socket.once('error', error => finish(error));
        socket.once('end', () => {
            if (!settled) finish(new Error('Server closed the connection before a NUL-terminated response arrived.'));
        });
    });
}

async function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(`Error: ${error.message}\n`);
        console.error(usage());
        process.exitCode = 2;
        return;
    }

    if (options.help) {
        console.log(usage());
        return;
    }

    try {
        const command = readCommand(options);
        const response = await sendCommand({ port: options.port, command });
        process.stdout.write(`${response}\n`);
        if (response.startsWith('Error:')) process.exitCode = 1;
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main();
}

module.exports = { parseArgs, readCommand, sendCommand, usage };
