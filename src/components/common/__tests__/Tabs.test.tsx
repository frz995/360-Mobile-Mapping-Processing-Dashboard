import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../Tabs'

describe('Tabs primitive', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders tablist and triggers with correct accessibility roles', () => {
    render(
      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="account">Account Content</TabsContent>
        <TabsContent value="password">Password Content</TabsContent>
      </Tabs>
    )

    expect(screen.getByRole('tablist')).toBeInTheDocument()
    const triggers = screen.getAllByRole('tab')
    expect(triggers).toHaveLength(3)

    const accountTab = screen.getByRole('tab', { name: 'Account' })
    const passwordTab = screen.getByRole('tab', { name: 'Password' })

    expect(accountTab).toHaveAttribute('aria-selected', 'true')
    expect(accountTab).toHaveAttribute('tabindex', '0')
    expect(passwordTab).toHaveAttribute('aria-selected', 'false')
    expect(passwordTab).toHaveAttribute('tabindex', '-1')

    expect(screen.getByText('Account Content')).toBeInTheDocument()
  })

  it('renders an animated indicator inside the active tab trigger', () => {
    render(
      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
        </TabsList>
      </Tabs>
    )

    const accountTab = screen.getByRole('tab', { name: 'Account' })
    const indicator = screen.getByTestId('tabs-animated-indicator')
    expect(accountTab).toContainElement(indicator)
  })

  it('switches tabs when a trigger is clicked', () => {
    const onValueChange = vi.fn()
    render(
      <Tabs defaultValue="account" onValueChange={onValueChange}>
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
        </TabsList>
        <TabsContent value="account">Account Content</TabsContent>
        <TabsContent value="password">Password Content</TabsContent>
      </Tabs>
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Password' }))
    expect(onValueChange).toHaveBeenCalledWith('password')
    expect(screen.getByRole('tab', { name: 'Password' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Password Content')).toBeInTheDocument()
  })

  it('navigates with ArrowRight and ArrowLeft (roving tabindex)', () => {
    render(
      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
      </Tabs>
    )

    const account = screen.getByRole('tab', { name: 'Account' })
    fireEvent.keyDown(account, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Password' })).toHaveAttribute('aria-selected', 'true')

    const password = screen.getByRole('tab', { name: 'Password' })
    fireEvent.keyDown(password, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')
  })

  it('wraps around and supports Home and End keys', () => {
    render(
      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
      </Tabs>
    )

    const settings = screen.getByRole('tab', { name: 'Settings' })
    // ArrowRight on last wraps to first
    fireEvent.keyDown(settings, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')

    const account = screen.getByRole('tab', { name: 'Account' })
    // End key moves to last
    fireEvent.keyDown(account, { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')

    // Home key moves to first
    fireEvent.keyDown(settings, { key: 'Home' })
    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')
  })

  it('respects disabled triggers', () => {
    render(
      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="password" disabled>Password</TabsTrigger>
        </TabsList>
      </Tabs>
    )

    const password = screen.getByRole('tab', { name: 'Password' })
    expect(password).toBeDisabled()
    fireEvent.click(password)
    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')
  })
})
