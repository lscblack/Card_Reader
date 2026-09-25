import { Link } from 'react-router'
import { Compass } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { Card } from '@/components/ui/Card'

export default function NotFoundPage() {
  return (
    <Card>
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you're looking for doesn't exist or was moved."
        action={
          <Link to="/dashboard" className="text-[13px] font-medium text-accent hover:underline">
            Back to overview
          </Link>
        }
      />
    </Card>
  )
}
