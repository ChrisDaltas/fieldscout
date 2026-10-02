import { SignInModal } from '@/components/landing/sign-in-modal'

/** "Sign in" clicked on the homepage: modal over the still-mounted landing page. */
export default function InterceptedLogin() {
  return <SignInModal intercepted />
}
