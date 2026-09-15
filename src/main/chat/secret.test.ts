import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSeal, open, seal, type SecretStore } from './secret.ts';

/** A store that "encrypts" by reversing the bytes: enough to prove the password is not written as given. */
function store(over: Partial<SecretStore> = {}): SecretStore {
    return {
        isEncryptionAvailable: () => true,
        encryptString: plain => Buffer.from(plain, 'utf8').reverse(),
        decryptString: sealed => Buffer.from(sealed).reverse().toString('utf8'),
        ...over
    };
}

test('a sealed password opens back to itself and is not the password in the file', () => {
    const sealed = seal('hunter2', store(), 'darwin');
    assert.ok(sealed !== null);
    assert.ok(!sealed.includes('hunter2'));
    assert.ok(!Buffer.from(sealed, 'base64').toString('utf8').includes('hunter2'));
    assert.equal(open(sealed, store(), 'darwin'), 'hunter2');
});

test('with no secret store nothing is sealed and nothing opens', () => {
    const none = store({ isEncryptionAvailable: () => false });
    assert.equal(canSeal(none, 'darwin'), false);
    assert.equal(seal('hunter2', none, 'darwin'), null);
    assert.equal(open(seal('hunter2', store(), 'darwin'), none, 'darwin'), null);
});

test('a store that throws on asking is treated as none', () => {
    const broken = store({
        isEncryptionAvailable: () => {
            throw new Error('not ready');
        }
    });
    assert.equal(canSeal(broken, 'win32'), false);
});

test('on Linux the basic_text backend is not a store, and a real keyring is', () => {
    assert.equal(canSeal(store({ getSelectedStorageBackend: () => 'basic_text' }), 'linux'), false);
    assert.equal(canSeal(store({ getSelectedStorageBackend: () => 'unknown' }), 'linux'), false);
    assert.equal(canSeal(store(), 'linux'), false, 'a Linux store that cannot say which backend is not trusted either');
    assert.equal(canSeal(store({ getSelectedStorageBackend: () => 'gnome_libsecret' }), 'linux'), true);
    assert.equal(canSeal(store({ getSelectedStorageBackend: () => 'basic_text' }), 'darwin'), true, 'the backend question is only asked on Linux');
});

test('a blob that will not open reads as no password rather than failing the launch', () => {
    const refusing = store({
        decryptString: () => {
            throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
        }
    });
    assert.equal(open('AAAA', refusing, 'darwin'), null);
    assert.equal(open(null, store(), 'darwin'), null);
    assert.equal(open('', store(), 'darwin'), null);
});

test('a store that fails to encrypt leaves nothing to write', () => {
    const failing = store({
        encryptString: () => {
            throw new Error('keychain locked');
        }
    });
    assert.equal(seal('hunter2', failing, 'darwin'), null);
});
