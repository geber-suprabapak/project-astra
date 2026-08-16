import { createClient } from '@supabase/supabase-js'
import { createInterface } from 'node:readline'

function parseArgs(argv: string[]): Map<string, string | boolean> {
  const args = new Map<string, string | boolean>()
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i]
    if (!current.startsWith('--')) continue

    const key = current.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args.set(key, true)
      continue
    }

    args.set(key, next)
    i += 1
  }
  return args
}

function asString(value: string | boolean | undefined): string | null {
  if (value === true || value === false || value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readValue(args: Map<string, string | boolean>, key: string, envKey: string): string {
  const argValue = asString(args.get(key))
  if (argValue) return argValue

  const envValue = Bun.env[envKey]
  if (envValue?.trim()) return envValue.trim()

  throw new Error(`Missing ${key}. Set --${key} or ${envKey}.`)
}

function promptText(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Password prompt requires an interactive terminal.')
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    const stdout = process.stdout
    let value = ''

    const cleanup = () => {
      stdin.off('data', onData)
      if (stdin.isRaw) stdin.setRawMode(false)
      stdin.pause()
    }

    const finish = () => {
      cleanup()
      stdout.write('\n')
      resolve(value.trim())
    }

    const fail = (error: Error) => {
      cleanup()
      stdout.write('\n')
      reject(error)
    }

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          fail(new Error('Cancelled.'))
          return
        }
        if (char === '\r' || char === '\n') {
          finish()
          return
        }
        if (char === '\u0008' || char === '\u007f') {
          value = value.slice(0, -1)
          continue
        }
        value += char
      }
    }

    stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    stdin.on('data', onData)
  })
}

const args = parseArgs(process.argv.slice(2))
const supabaseUrl = readValue(args, 'supabase-url', 'SUPABASE_URL')
const supabaseAnonKey = readValue(args, 'anon-key', 'SUPABASE_ANON_KEY')
const argEmail = asString(args.get('email'))
const email = argEmail ?? Bun.env.AUTH_EMAIL?.trim() ?? (await promptText('Email: '))
const argPassword = asString(args.get('password'))
const password = argPassword ?? Bun.env.AUTH_PASSWORD?.trim() ?? (await promptSecret('Password: '))

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

const { data, error } = await supabase.auth.signInWithPassword({ email, password })

if (error) {
  console.error(`Login failed: ${error.message}`)
  process.exit(1)
}

const token = data.session?.access_token
if (!token) {
  console.error('Login succeeded, but no access token was returned.')
  process.exit(1)
}

if (args.json === true) {
  console.log(
    JSON.stringify(
      {
        access_token: token,
        refresh_token: data.session?.refresh_token ?? null,
        expires_at: data.session?.expires_at ?? null,
        user_id: data.user.id,
      },
      null,
      2,
    ),
  )
} else {
  console.log(token)
}
