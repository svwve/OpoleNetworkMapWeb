package com.example.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;
import java.net.URI;

@Component
public class ApiSessionInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws IOException {
        if (!request.getRequestURI().startsWith(request.getContextPath() + "/api/")) {
            return true;
        }

        String path = request.getRequestURI().substring(request.getContextPath().length());
        boolean publicAuthRequest = "POST".equals(request.getMethod())
                && ("/api/auth/login".equals(path) || "/api/auth/register".equals(path));
        if (publicAuthRequest) {
            return true;
        }

        HttpSession session = request.getSession(false);
        if (session == null || session.getAttribute("username") == null) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Zaloguj się, aby kontynuować.");
            return false;
        }

        if (isMutation(request.getMethod()) && !isSameOrigin(request)) {
            response.sendError(HttpServletResponse.SC_FORBIDDEN, "Żądanie spoza tej witryny zostało zablokowane.");
            return false;
        }

        boolean logout = "POST".equals(request.getMethod()) && "/api/auth/logout".equals(path);
        boolean admin = "ADMIN".equals(session.getAttribute("role"));
        if (("/api/users".equals(path) || path.startsWith("/api/users/")) && !admin) {
            response.sendError(HttpServletResponse.SC_FORBIDDEN, "Dostęp do zarządzania użytkownikami wymaga uprawnień administratora.");
            return false;
        }
        if (isMutation(request.getMethod()) && !logout && !admin) {
            response.sendError(HttpServletResponse.SC_FORBIDDEN, "Ta operacja wymaga uprawnień administratora.");
            return false;
        }
        return true;
    }

    private boolean isMutation(String method) {
        return "POST".equals(method) || "PUT".equals(method)
                || "PATCH".equals(method) || "DELETE".equals(method);
    }

    private boolean isSameOrigin(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        if (origin == null || origin.isBlank()) {
            return true;
        }
        try {
            URI source = URI.create(origin);
            int sourcePort = source.getPort() == -1 ? defaultPort(source.getScheme()) : source.getPort();
            int requestPort = request.getServerPort() == -1
                    ? defaultPort(request.getScheme()) : request.getServerPort();
            return source.getScheme() != null
                    && source.getScheme().equalsIgnoreCase(request.getScheme())
                    && source.getHost() != null
                    && source.getHost().equalsIgnoreCase(request.getServerName())
                    && sourcePort == requestPort;
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private int defaultPort(String scheme) {
        return "https".equalsIgnoreCase(scheme) ? 443 : 80;
    }
}
