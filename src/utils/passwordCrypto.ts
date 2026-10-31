/**
 * Hachage de mot de passe compatible Navigateur (WebCrypto) et Node.js 20+ (`globalThis.crypto.subtle`)
 * au format déterministe : `pbkdf2_sha256$<iterations>$<saltHex>$<hashHex>`
 */

const PBKDF2_ITERATIONS = 100_000
const HASH_BITS = 256

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim()
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

export async function hashPasswordPBKDF2(
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = new Uint8Array(16)
  globalThis.crypto.getRandomValues(salt)

  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_BITS,
  )

  const hashHex = bytesToHex(new Uint8Array(derivedBits))
  const saltHex = bytesToHex(salt)
  return `pbkdf2_sha256$${iterations}$${saltHex}$${hashHex}`
}

export async function verifyPasswordPBKDF2(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
    return false
  }
  const iterations = Number.parseInt(parts[1], 10)
  if (!Number.isInteger(iterations) || iterations < 1_000 || iterations > 2_000_000 ||
      !/^[a-f0-9]{32}$/i.test(parts[2]) || !/^[a-f0-9]{64}$/i.test(parts[3])) {
    return false
  }
  const salt = hexToBytes(parts[2])
  const expectedHex = parts[3]

  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_BITS,
  )

  const actualHex = bytesToHex(new Uint8Array(derivedBits))
  return constantTimeEqualHex(actualHex, expectedHex)
}
