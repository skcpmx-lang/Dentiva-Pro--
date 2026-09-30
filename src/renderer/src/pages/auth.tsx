import { useState } from 'react'
import { Stethoscope, ShieldCheck, Building2, UserRound, KeyRound, CheckCircle2 } from 'lucide-react'
import { call } from '../ipc'
import { useApp } from '../store'
import { Button, Field, toast } from '../ui'
import type { SetupState } from '@shared/ipc'

/* ================= First-run setup wizard ================= */
export function SetupPage(): React.ReactNode {
  const { enterSession } = useApp()
  const [state, setState] = useState<SetupState | null>(null)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)

  const [code, setCode] = useState('')
  const [clinic, setClinic] = useState({ name: '', address: '', phone: '' })
  const [dentist, setDentist] = useState({ fullName: '', designations: '', qualifications: '' })
  const [admin, setAdmin] = useState({ username: '', password: '', confirm: '', displayName: '' })

  if (!state) {
    void call('setup.state').then((s) => setState(s))
    return <div className="setup-hero"><div className="setup-card"><div className="spinner" style={{ margin: '40px auto' }} /></div></div>
  }
  const startStep = state.activated ? 1 : 0
  const activeStep = step === 0 && state.activated ? 1 : step || startStep

  const activate = async (): Promise<void> => {
    setBusy(true)
    try {
      await call('setup.activate', { code: code.trim() })
      setState({ ...state, activated: true })
      setStep(1)
      toast('Application activated.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Activation failed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const finish = async (): Promise<void> => {
    if (admin.password !== admin.confirm) {
      toast('The passwords do not match.', 'error')
      return
    }
    setBusy(true)
    try {
      const result = await call('setup.complete', {
        clinic: { name: clinic.name.trim(), address: clinic.address.trim(), phone: clinic.phone.trim() },
        dentists: [
          {
            fullName: dentist.fullName.trim(),
            designations: dentist.designations.split(',').map((s) => s.trim()).filter(Boolean),
            qualifications: dentist.qualifications.split(',').map((s) => s.trim()).filter(Boolean)
          }
        ],
        admin: { username: admin.username.trim(), password: admin.password, displayName: admin.displayName.trim() || admin.username.trim() },
        settings: { autoLockMinutes: 10, backupFolder: null, theme: 'light', density: 'comfortable' }
      })
      // Land directly in the app — reloading would clear the in-memory session
      // token and force a fresh login right after setup.
      await enterSession(result.token)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Setup failed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const steps = ['Activation', 'Clinic', 'Owner account']
  return (
    <div className="setup-hero">
      <div className="setup-card">
        <div className="auth-logo"><Stethoscope size={28} /></div>
        <div className="auth-title">Welcome to Dentiva Pro</div>
        <div className="auth-sub">Let’s set up your clinic in three quick steps.</div>
        <div className="wizard-steps">
          {steps.map((label, i) => (
            <div key={label} className={`wizard-step ${i < activeStep ? 'done' : ''} ${i === activeStep ? 'current' : ''}`}>
              <span className="dot">{i < activeStep ? <CheckCircle2 size={12} /> : i + 1}</span>
              {label}
            </div>
          ))}
        </div>

        {activeStep === 0 ? (
          <div className="col">
            <div className="row" style={{ justifyContent: 'center', color: 'var(--primary)', fontWeight: 700, gap: 7 }}>
              <ShieldCheck size={17} /> Offline activation
            </div>
            <p className="text-soft text-small" style={{ textAlign: 'center', margin: '4px 0 14px' }}>
              Enter the activation code provided with your purchase. Activation is one-time and works fully offline.
            </p>
            <Field label="Activation code" required hint="Digits only — separators are ignored.">
              <input
                className="input" style={{ textAlign: 'center', fontSize: 18, letterSpacing: 3, fontFamily: 'monospace' }}
                value={code} onChange={(e) => setCode(e.target.value)} placeholder="•••• •••• •••• ••••" autoFocus
                onKeyDown={(e) => e.key === 'Enter' && void activate()} spellCheck={false}
              />
            </Field>
            <Button variant="primary" block size="lg" loading={busy} onClick={() => void activate()}>Activate</Button>
          </div>
        ) : activeStep === 1 ? (
          <div className="col">
            <div className="form-grid">
              <Field label="Clinic name" required span>
                <input className="input" value={clinic.name} onChange={(e) => setClinic({ ...clinic, name: e.target.value })} placeholder="e.g. Smile Dental Care" autoFocus />
              </Field>
              <Field label="Address" span>
                <input className="input" value={clinic.address} onChange={(e) => setClinic({ ...clinic, address: e.target.value })} placeholder="House, Road, Area, City" />
              </Field>
              <Field label="Phone" required>
                <input className="input" value={clinic.phone} onChange={(e) => setClinic({ ...clinic, phone: e.target.value })} placeholder="01XXXXXXXXX" />
              </Field>
              <Field label="Dentist full name" required>
                <input className="input" value={dentist.fullName} onChange={(e) => setDentist({ ...dentist, fullName: e.target.value })} placeholder="e.g. Dr. Rahim Khan" />
              </Field>
              <Field label="Designations" hint="Comma separated" span>
                <input className="input" value={dentist.designations} onChange={(e) => setDentist({ ...dentist, designations: e.target.value })} placeholder="Consultant, Oral &amp; Maxillofacial Surgeon" />
              </Field>
              <Field label="Qualifications" hint="Comma separated" span>
                <input className="input" value={dentist.qualifications} onChange={(e) => setDentist({ ...dentist, qualifications: e.target.value })} placeholder="BDS, FCPS" />
              </Field>
            </div>
            <div className="row mt-3" style={{ justifyContent: 'flex-end' }}>
              <Button variant="primary" size="lg" disabled={!clinic.name || !clinic.phone || !dentist.fullName} onClick={() => setStep(2)}>
                Continue <Building2 size={15} />
              </Button>
            </div>
          </div>
        ) : (
          <div className="col">
            <div className="form-grid">
              <Field label="Owner full name" required>
                <input className="input" value={admin.displayName} onChange={(e) => setAdmin({ ...admin, displayName: e.target.value })} placeholder="Your name" autoFocus />
              </Field>
              <Field label="Username" required hint="Used to sign in — lowercase letters and numbers.">
                <input className="input" value={admin.username} onChange={(e) => setAdmin({ ...admin, username: e.target.value })} placeholder="owner" spellCheck={false} />
              </Field>
              <Field label="Password" required hint="At least 8 characters with a letter and a digit.">
                <input className="input" type="password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} />
              </Field>
              <Field label="Confirm password" required>
                <input className="input" type="password" value={admin.confirm} onChange={(e) => setAdmin({ ...admin, confirm: e.target.value })} />
              </Field>
            </div>
            <div className="row mt-3">
              <Button onClick={() => setStep(1)}>Back</Button>
              <div className="spacer" />
              <Button
                variant="primary" size="lg" loading={busy}
                disabled={!admin.username || !admin.password || admin.password !== admin.confirm}
                onClick={() => void finish()}
              >
                <UserRound size={15} /> Create owner &amp; start
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ================= Login ================= */
export function LoginPage(): React.ReactNode {
  const { enterSession, boot } = useApp()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (): Promise<void> => {
    if (!username || !password) return
    setBusy(true)
    setError('')
    try {
      const result = await call('auth.login', { username: username.trim(), password })
      await enterSession(result.token)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  void boot

  return (
    <div className="center-screen">
      <div className="auth-card">
        <div className="auth-logo"><Stethoscope size={28} /></div>
        <div className="auth-title">Dentiva Pro</div>
        <div className="auth-sub">Premium dental clinic management</div>
        <div className="col">
          <Field label="Username">
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus spellCheck={false}
              onKeyDown={(e) => e.key === 'Enter' && void submit()} />
          </Field>
          <Field label="Password" error={error || undefined}>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()} />
          </Field>
          <Button variant="primary" block size="lg" loading={busy} onClick={() => void submit()}>
            <KeyRound size={16} /> Sign in
          </Button>
          <div className="hint" style={{ textAlign: 'center', marginTop: 4 }}>
            Works completely offline · Data stays on this computer
          </div>
        </div>
      </div>
    </div>
  )
}

/* ================= Locked screen ================= */
export function LockedPage(): React.ReactNode {
  const { session, refreshSession } = useApp()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const unlock = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await call('auth.unlock', { password })
      await refreshSession()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unlock failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-card">
        <div className="auth-logo"><KeyRound size={26} /></div>
        <div className="auth-title">Locked</div>
        <div className="auth-sub">Enter your password to continue as {session?.user.displayName ?? session?.user.username}.</div>
        <div className="col">
          <Field label="Password" error={error || undefined}>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus
              onKeyDown={(e) => e.key === 'Enter' && void unlock()} />
          </Field>
          <Button variant="primary" block size="lg" loading={busy} onClick={() => void unlock()}>Unlock</Button>
        </div>
      </div>
    </div>
  )
}
