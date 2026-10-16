#!/usr/bin/env node
import { main, runPicker } from '../dist/main.js'

const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true

// Only `tracey listen` intercepts Ctrl-C (to print a final report); everything else keeps the default.
const stop = process.argv[2] === 'listen' ? new Promise((resolve) => process.once('SIGINT', resolve)) : undefined

process.exitCode = await main(process.argv.slice(2), {
  listen: { tty: process.stdout.isTTY === true, stop },
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  color: !process.env.NO_COLOR && process.stdout.isTTY === true,
  ...(interactive && {
    pick: (sessions) =>
      runPicker(sessions, { stdin: process.stdin, write: (s) => process.stdout.write(s), color: !process.env.NO_COLOR }),
  }),
})
