#!/usr/bin/env node
/**
 * One-shot CLI to generate a BREAK_GLASS_PASSWORD_HASH value for server/.env.
 *
 *     node server/hashBreakGlassPassword.mjs
 *
 * Prompts for the password (not echoed), prints the hash to paste into server/.env.
 * Never writes the plaintext anywhere.
 */

import readline from 'node:readline';
import { hashBreakGlassPassword } from './breakGlass.mjs';

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Suppress echo of typed characters — readline has no built-in "hidden" mode.
    const onWriteToOutput = () => {};
    // @ts-ignore -- _writeToOutput is undocumented but the standard way to do this with readline
    rl._writeToOutput = onWriteToOutput;
    process.stdout.write(question);
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const password = await promptHidden('Break-glass password: ');
if (!password) {
  console.error('No password entered.');
  process.exit(1);
}
console.log('\nBREAK_GLASS_PASSWORD_HASH=' + hashBreakGlassPassword(password));
console.log('\nPaste that line into server/.env. The plaintext was never written anywhere.');
