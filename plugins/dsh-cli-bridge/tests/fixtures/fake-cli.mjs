import readline from 'node:readline'

const name = process.argv[2] ?? 'unknown'
const mode = process.argv[3] ?? 'interactive'

console.log(`READY:${name}`)
if (mode === 'hang') console.log(`HANGING:${name}`)

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', (line) => {
  if (line === 'exit') {
    console.log(`EXIT:${name}`)
    process.exit(0)
  }
  console.log(`INPUT:${name}:${line}`)
})

process.on('SIGINT', () => {
  console.log(`SIGINT:${name}`)
  process.exit(130)
})
