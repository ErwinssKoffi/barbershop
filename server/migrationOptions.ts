/** Explicit CLI opt-ins only; approval is not a backup operation. */
export function marketplaceMigrationOptions(args: readonly string[], backupVerified: string | undefined, bookingBackupVerified?: string): { includeMarketplace: boolean; includeScheduling?: boolean; includePublicCatalog?: boolean; includeMedia?: boolean; includeNotifications?: boolean; includeAppointmentServices?: boolean; includeScheduleBlocks?: boolean; includeProfileDetails?: boolean; includeVisibilityEditor?: boolean; includeVisibilityPublication?: boolean; includeSubscriptions?: boolean; includePlatformActivation?: boolean; includePublicAccessEnforcement?: boolean; includeTextPublication?: boolean } {
  const includeTextPublication=args.includes('--include-text-publication')
  if(includeTextPublication && backupVerified!=='true')throw new Error('Text publication backup/restore approval required')
  const includePublicAccessEnforcement=args.includes('--include-public-access-enforcement')
  if(includePublicAccessEnforcement && backupVerified!=='true')throw new Error('Public access backup/restore approval required')
  const includePlatformActivation=args.includes('--include-platform-activation')
  if(includePlatformActivation && backupVerified!=='true')throw new Error('Platform activation backup/restore approval required')
  const includeSubscriptions = args.includes('--include-subscriptions')
  if(includeSubscriptions && backupVerified!=='true')throw new Error('Subscription backup/restore approval required')
  const includeVisibilityPublication = args.includes('--include-visibility-unpublish')
  const includeVisibilityEditor = args.includes('--include-visibility-editor')
  const includeProfileDetails = args.includes('--include-profile-details')
  const includeScheduleBlocks = args.includes('--include-schedule-blocks')
  if (includeScheduleBlocks && backupVerified !== 'true') throw new Error('Schedule blocks backup/restore approval required')
  const includeAppointmentServices = args.includes('--include-appointment-services')
  if (includeAppointmentServices && bookingBackupVerified !== 'true') throw new Error('Booking backup/restore approval required')
  if (includeAppointmentServices && backupVerified !== 'true') throw new Error('Appointment snapshot backup/restore approval required')
  const includeNotifications = args.includes('--include-notifications')
  if (includeNotifications && backupVerified !== 'true') throw new Error('Notification backup/restore approval required')
  const includeMedia = args.includes('--include-media')
  const includePublicCatalog = args.includes('--include-public-catalog')
  const includeScheduling = args.includes('--include-scheduling')
  const includeMarketplace = args.includes('--include-marketplace') || includeScheduling || includePublicCatalog || includeMedia || includeProfileDetails || includeVisibilityEditor || includeVisibilityPublication
  if (includeMarketplace && backupVerified !== 'true') throw new Error('Marketplace backup/restore approval required')
  return { includeMarketplace, ...(includeTextPublication ? {includeTextPublication:true} : {}), ...(includePublicAccessEnforcement ? {includePublicAccessEnforcement:true} : {}), ...(includePlatformActivation ? {includePlatformActivation:true} : {}), ...(includeSubscriptions ? {includeSubscriptions:true} : {}), ...(includeVisibilityPublication ? {includeVisibilityPublication:true} : {}), ...(includeVisibilityEditor ? {includeVisibilityEditor:true} : {}), ...(includeProfileDetails ? { includeProfileDetails: true } : {}), ...(includeScheduleBlocks ? { includeScheduleBlocks: true } : {}), ...(includeAppointmentServices ? { includeAppointmentServices: true } : {}), ...(includeNotifications ? { includeNotifications: true } : {}), ...(includeScheduling ? { includeScheduling: true } : {}), ...(includePublicCatalog ? { includePublicCatalog: true } : {}), ...(includeMedia ? { includeMedia: true } : {}) }
}
