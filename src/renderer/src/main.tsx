import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

class ErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <div className="boot-screen"><h1>页面遇到了一点问题</h1><p>播放服务会保留当前状态，重新加载界面后可继续使用。</p><button className="button primary" onClick={() => location.reload()}>重新加载</button></div> : this.props.children }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>)
