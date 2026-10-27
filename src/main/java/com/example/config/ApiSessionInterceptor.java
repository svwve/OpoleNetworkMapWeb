package com.example.config;

import com.example.backend.UserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;
import java.net.URI;

@Component
public class ApiSessionInterceptor implements HandlerInterceptor {
    private final UserService userService;

    public ApiSessionInterceptor(UserService userService) {
        this.userService = userService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws IOException {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        boolean apiRequest = path.startsWith("/api/");
        boolean protectedPage = "/map.html".equals(path) || "/projects.html".equals(path)
                || "/admin.html".equals(path);
        if (!apiRequest && !protectedPage) {
            return true;
        }

        boolean publicAuthRequest = "POST".equals(request.getMethod())
                && ("/api/auth/login".equals(path) || "/api/auth/register".equals(path));
        boolean sessionCheck = "GET".equals(request.getMethod()) && "/api/auth/session".equals(path);
        boolean initializeProject = "POST".equals(request.getMethod())
                && "/api/projects/initialize".equals(path);
        if (publicAuthRequest || (apiRequest && sessionCheck)) {
            return true;
        }

        HttpSession session = request.getSession(false);
        if (session == null || !userService.isValidSession(
                (String) session.getAttribute("username"),
                session.getAttribute("userId"),
                session.getAttribute("role"))) {
            if (session != null) {
                session.invalidate();
            }
            if (protectedPage) {
                response.sendRedirect(request.getContextPath() + "/index.html");
                return false;
            }
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Zaloguj się, aby kontynuować.");
            return false;
        }

        if (apiRequest && isMutation(request.getMethod()) && !isSameOrigin(request)) {
            response.sendError(HttpServletResponse.SC_FORBIDDEN, "Żądanie spoza tej witryny zostało zablokowane.");
            return false;
        }

        boolean logout = "POST".equals(request.getMethod()) && "/api/auth/logout".equals(path);
        boolean admin = "ADMIN".equals(session.getAttribute("role"));
        if ("/admin.html".equals(path) && !admin) {
            response.sendRedirect(request.getContextPath() + "/projects.html");
            return false;
        }
        if (!apiRequest) {
            return true;
        }
        if (path.equals("/api/admin") || path.startsWith("/api/admin/")) {
            if (!admin) {
                response.sendError(HttpServletResponse.SC_FORBIDDEN,
                        "Dostęp do panelu administracyjnego wymaga uprawnień administratora.");
                return false;
            }
        }
        if (("/api/users".equals(path) || path.startsWith("/api/users/")) && !admin) {
            response.sendError(HttpServletResponse.SC_FORBIDDEN, "Dostęp do zarządzania użytkownikami wymaga uprawnień administratora.");
            return false;
        }
        if (isMutation(request.getMethod()) && !logout && !initializeProject && !admin) {
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
