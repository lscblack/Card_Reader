import { Link } from 'react-router'
import { Compass } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useBusiness } from '../hooks/context'

export default function NotFound() {
  const { base } = useBusiness()
  return (
    <Card>
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="This page doesn’t exist in the business dashboard."
        action={
          <Link to={base}>
            <Button variant="primary" size="sm">
              Back to overview
            </Button>
          </Link>
        }
      />
    </Card>
  )
}
