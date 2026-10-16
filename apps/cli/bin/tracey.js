#!/usr/bin/env node
import { main } from '../dist/main.js'

process.exitCode = await main(process.argv.slice(2), {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  color: !process.env.NO_COLOR && process.stdout.isTTY === true,
})
