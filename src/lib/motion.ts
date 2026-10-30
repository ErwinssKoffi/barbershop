import type { Transition, Variants } from 'framer-motion'

/**
 * Courbe d'accélération fluide type Linear / Vercel / Apple UI
 */
export const MOTION_EASE: [number, number, number, number] = [
  0.22, 1, 0.36, 1,
]

/**
 * Durées calibrées (en secondes) pour homogénéiser toutes les animations SALON PRO
 */
export const MOTION_DURATION = {
  instant: 0.14,
  fast: 0.2,
  base: 0.28,
  medium: 0.36,
  slow: 0.55,
} as const

/**
 * Ressorts physiques pour la surélévation, le scale et l'inclinaison 3D
 */
export const SPRING_ELEVATION: Transition = {
  type: 'spring',
  stiffness: 360,
  damping: 26,
  mass: 0.65,
}

export const SPRING_SNAPPY: Transition = {
  type: 'spring',
  stiffness: 440,
  damping: 28,
  mass: 0.55,
}

export const SPRING_TILT_3D = {
  stiffness: 280,
  damping: 24,
  mass: 0.5,
} as const

/**
 * Variantes d'apparition de page avec légère surélévation
 */
export const pageTransitionVariants: Variants = {
  initial: {
    opacity: 0,
    y: 10,
    scale: 0.994,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: MOTION_DURATION.base,
      ease: MOTION_EASE,
    },
  },
}

/**
 * Variantes 3D pour menus déroulants (Select & DropdownMenu)
 */
export const popover3DVariants: Variants = {
  initial: {
    opacity: 0,
    y: -8,
    scale: 0.96,
    rotateX: -10,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    rotateX: 0,
    transition: {
      duration: MOTION_DURATION.fast,
      ease: MOTION_EASE,
    },
  },
}

/**
 * Variantes 3D pour fenêtres modales (Modal & Recherche ⌘K)
 */
export const modalDialog3DVariants: Variants = {
  initial: {
    opacity: 0,
    y: 18,
    scale: 0.95,
    rotateX: 8,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    rotateX: 0,
    transition: {
      duration: MOTION_DURATION.base,
      ease: MOTION_EASE,
    },
  },
}
