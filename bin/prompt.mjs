/**
 * Zero-dependency prompts for the interactive commands.
 *
 * - `?` at any question prints the step's help and asks again
 * - numbered choices, yes/no, free text with validation
 * - works in a terminal and with piped input (answers are queued and echoed)
 * - `yes` mode answers every question with its default (for scripts: `run --yes`)
 */

import { createInterface } from 'readline';

export function createPrompter({ style, t, yes = false }) {
  const { c, dim, err } = style;
  const interactive = !!process.stdin.isTTY;
  let rl = null;
  const queued = [];
  const waiting = [];
  let ended = false;

  function open() {
    if (rl || yes) return;
    rl = createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });
    if (!interactive) {
      rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : queued.push(line)));
    }
    rl.on('close', () => {
      ended = true;
      if (waiting.length) inputEnded();
    });
  }

  function inputEnded() {
    console.error(`\n\n${err(t().inputEnded)}\n`);
    process.exit(1);
  }

  /** Reads one raw line. */
  function readLine(question) {
    if (yes) {
      process.stdout.write(question + '\n');
      return Promise.resolve('');
    }
    open();
    if (interactive) return new Promise((res) => rl.question(question, res));
    process.stdout.write(question);
    const echo = (line) => { process.stdout.write(line + '\n'); return line; };
    if (queued.length) return Promise.resolve(echo(queued.shift()));
    if (ended) inputEnded();
    return new Promise((res) => waiting.push((line) => res(echo(line))));
  }

  function showHelp(help) {
    const lines = Array.isArray(help) ? help : [help];
    console.log(`\n  ${c.cyan}ℹ ${t().helpTitle}${c.reset}`);
    for (const line of lines) console.log(`  ${c.cyan}│${c.reset} ${line}`);
    console.log('');
  }

  const isHelp = (answer) => ['?', 'help', 'ajuda', 'info'].includes(answer.trim().toLowerCase());

  return {
    /** Free text. `validate(value)` returns an error message or null. */
    async input({ question, help, defaultValue = '', validate }) {
      while (true) {
        const hint = defaultValue ? ` ${dim(`[${defaultValue}]`)}` : '';
        const answer = (await readLine(`  ${question}${hint}: `)).trim();
        if (help && isHelp(answer)) { showHelp(help); continue; }
        const value = answer || defaultValue;
        const problem = validate?.(value);
        if (problem) {
          console.log(`  ${err(problem)}`);
          if (yes) process.exit(1);
          continue;
        }
        return value;
      }
    },

    /** Numbered choice. options: [{ value, label, hint }]; returns the chosen value. */
    async choose({ question, help, options, defaultValue, note }) {
      const defaultIndex = Math.max(0, options.findIndex((o) => o.value === defaultValue));
      console.log(`  ${question}${note ? dim(`  (${note})`) : ''}`);
      options.forEach((o, i) => {
        const marker = i === defaultIndex ? `${c.cyan}›${c.reset}` : ' ';
        console.log(`  ${marker} ${c.bold}${i + 1}${c.reset}) ${o.label}${o.hint ? dim(`  — ${o.hint}`) : ''}`);
      });
      while (true) {
        const answer = (await readLine(`  ${dim(`[${defaultIndex + 1}]`)}: `)).trim().toLowerCase();
        if (help && isHelp(answer)) { showHelp(help); continue; }
        if (answer === '') return options[defaultIndex].value;
        const n = Number(answer);
        if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1].value;
        const byValue = options.find((o) => o.value === answer);
        if (byValue) return byValue.value;
        console.log(`  ${err(t().invalidChoice(options.length))}`);
      }
    },

    /** Yes / no. */
    async confirm({ question, help, defaultValue = true }) {
      while (true) {
        const answer = (await readLine(`  ${question} ${dim(t().yesNo(defaultValue))}: `)).trim().toLowerCase();
        if (help && isHelp(answer)) { showHelp(help); continue; }
        if (answer === '') return defaultValue;
        if (t().yes.includes(answer)) return true;
        if (t().no.includes(answer)) return false;
      }
    },

    close() {
      rl?.close();
      rl = null;
    },
  };
}
