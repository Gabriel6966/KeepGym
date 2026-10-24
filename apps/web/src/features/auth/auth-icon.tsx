import Image from 'next/image';

// Local SVG exports of the same MIT-licensed Radix icons used by the prototype.
export function AuthIcon({
  name,
}: {
  name: 'arrow-left' | 'arrow-right' | 'reload';
}) {
  return (
    <Image
      className="auth-icon"
      src={`/images/auth/${name}.svg`}
      alt=""
      aria-hidden="true"
      width={23}
      height={23}
      unoptimized
    />
  );
}
