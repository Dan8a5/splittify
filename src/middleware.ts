import { defineMiddleware } from 'astro:middleware'
import { createSupabaseServerClient } from './lib/supabase'

const protectedPaths = ['/dashboard', '/groups']

export const onRequest = defineMiddleware(async (context, next) => {
  const isProtected = protectedPaths.some(p => context.url.pathname.startsWith(p))
  if (!isProtected) return next()

  const supabase = createSupabaseServerClient(context.request, context.cookies)
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return context.redirect('/signin')

  context.locals.user = user
  return next()
})
