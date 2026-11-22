import React from "react";
import { NavLink, Outlet } from "react-router-dom";

export function AppShell() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <NavLink className="brand" to="/">Lecture<span>Flow</span></NavLink>
        <nav className="main-nav" aria-label="Main navigation">
          <NavLink className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} to="/library">Library</NavLink>
          <NavLink className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} to="/upload">Upload</NavLink>
        </nav>
      </header>
      <main className="page-content"><Outlet /></main>
    </div>
  );
}
