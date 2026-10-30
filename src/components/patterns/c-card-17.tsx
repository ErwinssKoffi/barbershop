import { ChevronRightIcon, ShoppingBagIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

const item = {
  title: 'Recent Orders Overview',
  description:
    'Track and review all recent purchases, updates, and status changes in one place.',
  link: 'View Orders',
  icon: <ShoppingBagIcon aria-hidden="true" />,
}

export function Pattern() {
  return (
    <Card className="w-full max-w-xs">
      <CardContent className="flex flex-col gap-3">
        <div className="bg-primary rounded-md [&_svg]:text-primary-foreground flex size-11 items-center justify-center [&_svg]:size-5">
          {item.icon}
        </div>
        <a
          href="#"
          className="text-foreground hover:text-primary block text-sm leading-tight font-medium"
        >
          {item.title}
        </a>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {item.description}
        </p>
        <a
          href="#"
          className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
        >
          {item.link}
          <ChevronRightIcon aria-hidden="true" className="size-2.5 shrink-0" />
        </a>
      </CardContent>
    </Card>
  )
}
