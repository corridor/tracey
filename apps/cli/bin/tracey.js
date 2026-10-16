#!/usr/bin/env node
import { main, runPicker } from '../dist/main.js'

const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true

process.exitCode = await main(process.argv.slice(2), {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  color: !process.env.NO_COLOR && process.stdout.isTTY === true,
  ...(interactive && {
    pick: (sessions) =>
      runPicker(sessions, { stdin: process.stdin, write: (s) => process.stdout.write(s), color: !process.env.NO_COLOR }),
  }),
})
