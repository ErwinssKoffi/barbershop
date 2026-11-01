import { beforeEach,expect,it,vi } from 'vitest'
import { render,screen,fireEvent } from '@testing-library/react'
import { AuthContext,type AuthContextValue } from '../contexts/authContext'
import { SubscriptionPanel } from '../features/visibility/SubscriptionPanel'
import { subscriptionAccessRequest } from '../lib/visibilityClient'
vi.mock('../lib/visibilityClient',()=>({subscriptionAccessRequest:vi.fn()}))
const none={state:'absent',planName:null,startsAt:null,endsAt:null,graceEndsAt:null}
function panel(){return <AuthContext.Provider value={{currentUser:{id:'manager',tenantId:'tenant',role:'manager',isActive:true}} as AuthContextValue}><SubscriptionPanel/></AuthContext.Provider>}
beforeEach(()=>vi.resetAllMocks())
it('affiche offre validée sans la présenter comme abonnement actif et lit état réel',async()=>{
 vi.mocked(subscriptionAccessRequest).mockResolvedValue(none)
 render(panel())
 expect(screen.getByText(/Ces informations ne constituent ni une souscription active/)).toBeInTheDocument()
 expect(subscriptionAccessRequest).not.toHaveBeenCalled()
 fireEvent.click(screen.getByText('Consulter mon abonnement'))
 await screen.findByText('Aucun abonnement enregistré')
 expect(screen.queryByRole('button',{name:/payer|activer/i})).not.toBeInTheDocument()
})
it('erreur cloud sans abonnement local fictif',async()=>{
 vi.mocked(subscriptionAccessRequest).mockRejectedValue(new Error('Migration 019 requise.'))
 render(panel());fireEvent.click(screen.getByText('Consulter mon abonnement'))
 await screen.findByText('Migration 019 requise.')
 expect(screen.queryByText('Période active')).not.toBeInTheDocument()
})
