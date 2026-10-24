import { AuthIcon } from './auth-icon';
import Image from 'next/image';
import Link from 'next/link';
import { AuthPageShell } from './auth-page-shell';

export function AuthAbout({ loginHref }: { loginHref: string }) {
  return (
    <AuthPageShell mode="about">
      <article className="auth-form-view auth-about">
        <Link href={loginHref} prefetch={false} className="auth-back">
          <AuthIcon name="arrow-left" />
          Volver
        </Link>
        <p className="auth-eyebrow">CONOCE KEEPGYM</p>
        <h1>
          Tu entrenamiento.
          <br />
          <span>Tu historia.</span>
        </h1>
        <p className="auth-about-lead">
          Una idea sencilla: que registrar tu entrenamiento sea tan natural como
          entrenar.
        </p>
        <Image
          className="auth-about-photo"
          src="/images/auth/gym-hand.png"
          alt="Una mano sujetando una mancuerna en el gimnasio"
          width={1024}
          height={1536}
          unoptimized
          loading="eager"
        />
        <h2>Un espacio para tu evolución</h2>
        <p>
          KeepGym te ayuda a registrar entrenamientos, organizar rutinas y
          consultar tu historial.
        </p>
        <p>
          Para quien empieza y para quien lleva años entrenando. A tu ritmo, con
          tus datos a mano.
        </p>
        <Link
          href={loginHref}
          prefetch={false}
          className="auth-button auth-button--primary"
        >
          Volver a Login
          <AuthIcon name="arrow-right" />
        </Link>
      </article>
    </AuthPageShell>
  );
}
