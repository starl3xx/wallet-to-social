import type { CSSProperties } from 'react';
import styles from './rolling-number.module.css';

/** Decorative odometer reels; assistive technology reads only the final value. */
export function RollingNumber({ value }: { value: string }) {
  return (
    <span className={styles.number}>
      <span className="sr-only">{value}</span>
      <span key={value} aria-hidden="true" className={styles.reels}>
        {Array.from(value).map((character, index) => {
          if (!/\d/.test(character))
            return <span key={index}>{character}</span>;
          const steps = 10 + Number(character);
          return (
            <span className={styles.window} key={index}>
              <span
                className={styles.track}
                style={
                  {
                    '--roll-end': `${-steps}em`,
                    '--roll-delay': `${index * 45}ms`,
                  } as CSSProperties
                }
              >
                {Array.from({ length: steps + 1 }, (_, step) => (
                  <span className={styles.digit} key={step}>
                    {step % 10}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
