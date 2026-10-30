package com.example.config;

import com.example.backend.UserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.any;
import static org.mockito.Mockito.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ApiSessionInterceptorTest {

    private final UserService userService = mock(UserService.class);
    private final ApiSessionInterceptor interceptor = new ApiSessionInterceptor(userService);

    ApiSessionInterceptorTest() {
        when(userService.isValidSession(anyString(), any(), any())).thenReturn(true);
    }

    @Test
    void rejectsUnauthenticatedApiRequests() throws Exception {
        HttpServletRequest request = request("GET", "/api/map/cameras", null);
        HttpServletResponse response = mock(HttpServletResponse.class);

        assertFalse(interceptor.preHandle(request, response, new Object()));
        verify(response).sendError(HttpServletResponse.SC_UNAUTHORIZED, "Zaloguj się, aby kontynuować.");
    }

    @Test
    void redirectsUnauthenticatedRequestsForProtectedPages() throws Exception {
        HttpServletRequest request = request("GET", "/map.html", null);
        HttpServletResponse response = mock(HttpServletResponse.class);

        assertFalse(interceptor.preHandle(request, response, new Object()));
        verify(response).sendRedirect("/index.html");
    }

    @Test
    void rejectsSessionsThatAreNoLongerApproved() throws Exception {
        HttpServletRequest request = request("GET", "/api/projects", "OPERATOR");
        when(userService.isValidSession("test-user", 9L, "OPERATOR")).thenReturn(false);
        HttpServletResponse response = mock(HttpServletResponse.class);

        assertFalse(interceptor.preHandle(request, response, new Object()));
        verify(response).sendError(HttpServletResponse.SC_UNAUTHORIZED, "Zaloguj się, aby kontynuować.");
    }

    @Test
    void restrictsAdminApiToAdministratorSessions() throws Exception {
        HttpServletRequest request = request("GET", "/api/admin/users", "USER");
        HttpServletResponse response = mock(HttpServletResponse.class);

        assertFalse(interceptor.preHandle(request, response, new Object()));
        verify(response).sendError(HttpServletResponse.SC_FORBIDDEN,
                "Dostęp do panelu administracyjnego wymaga uprawnień administratora.");
    }

    @Test
    void redirectsOperatorsAwayFromTheAdminPage() throws Exception {
        HttpServletRequest request = request("GET", "/admin.html", "OPERATOR");
        HttpServletResponse response = mock(HttpServletResponse.class);

        assertFalse(interceptor.preHandle(request, response, new Object()));
        verify(response).sendRedirect("/projects.html");
    }

    @Test
    void allowsPublicLoginAndRegistration() throws Exception {
        HttpServletRequest request = request("POST", "/api/auth/login", null);
        HttpServletResponse response = mock(HttpServletResponse.class);

        assertTrue(interceptor.preHandle(request, response, new Object()));
        verify(response, never()).sendError(org.mockito.ArgumentMatchers.anyInt(),
                org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void allowsSessionCheckWithoutAnExistingSession() throws Exception {
        HttpServletRequest request = request("GET", "/api/auth/session", null);
        HttpServletResponse response = mock(HttpServletResponse.class);

        assertTrue(interceptor.preHandle(request, response, new Object()));
        verify(request, never()).getSession(false);
        verify(response, never()).sendError(org.mockito.ArgumentMatchers.anyInt(),
                org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void rejectsWritesFromOperatorSessions() throws Exception {
        HttpServletRequest request = request("POST", "/api/map/cameras", "OPERATOR");
        when(request.getHeader("Origin")).thenReturn("http://localhost:8080");
        when(request.getScheme()).thenReturn("http");
        when(request.getServerName()).thenReturn("localhost");
        when(request.getServerPort()).thenReturn(8080);
        HttpServletResponse response = mock(HttpServletResponse.class);

        assertFalse(interceptor.preHandle(request, response, new Object()));
        verify(response).sendError(HttpServletResponse.SC_FORBIDDEN,
                "Ta operacja wymaga uprawnień administratora.");
    }

    @Test
    void allowsOperatorToInitializeDefaultProject() throws Exception {
        HttpServletRequest request = request("POST", "/api/projects/initialize", "OPERATOR");
        when(request.getHeader("Origin")).thenReturn("http://localhost:8080");
        when(request.getScheme()).thenReturn("http");
        when(request.getServerName()).thenReturn("localhost");
        when(request.getServerPort()).thenReturn(8080);
        HttpServletResponse response = mock(HttpServletResponse.class);

        assertTrue(interceptor.preHandle(request, response, new Object()));
        verify(response, never()).sendError(org.mockito.ArgumentMatchers.anyInt(),
                org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void allowsOperatorsToChangeTheirOwnPassword() throws Exception {
        HttpServletRequest request = request("POST", "/api/auth/change-password", "OPERATOR");
        when(request.getHeader("Origin")).thenReturn("http://localhost:8080");
        when(request.getScheme()).thenReturn("http");
        when(request.getServerName()).thenReturn("localhost");
        when(request.getServerPort()).thenReturn(8080);
        HttpServletResponse response = mock(HttpServletResponse.class);

        assertTrue(interceptor.preHandle(request, response, new Object()));
        verify(response, never()).sendError(org.mockito.ArgumentMatchers.anyInt(),
                org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void restrictsUserDirectoryToAdministrators() throws Exception {
        HttpServletRequest request = request("GET", "/api/users", "OPERATOR");
        HttpServletResponse response = mock(HttpServletResponse.class);

        assertFalse(interceptor.preHandle(request, response, new Object()));
        verify(response).sendError(HttpServletResponse.SC_FORBIDDEN,
                "Dostęp do zarządzania użytkownikami wymaga uprawnień administratora.");
    }

    @Test
    void rejectsCrossOriginAdminWrites() throws Exception {
        HttpServletRequest request = request("DELETE", "/api/map/cameras/1", "ADMIN");
        when(request.getHeader("Origin")).thenReturn("https://malicious.example");
        when(request.getScheme()).thenReturn("http");
        when(request.getServerName()).thenReturn("localhost");
        when(request.getServerPort()).thenReturn(8080);
        HttpServletResponse response = mock(HttpServletResponse.class);

        assertFalse(interceptor.preHandle(request, response, new Object()));
        verify(response).sendError(HttpServletResponse.SC_FORBIDDEN,
                "Żądanie spoza tej witryny zostało zablokowane.");
    }

    private HttpServletRequest request(String method, String uri, String role) {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getContextPath()).thenReturn("");
        when(request.getRequestURI()).thenReturn(uri);
        when(request.getMethod()).thenReturn(method);
        if (role != null) {
            HttpSession session = mock(HttpSession.class);
            when(session.getAttribute("username")).thenReturn("test-user");
            when(session.getAttribute("role")).thenReturn(role);
            when(session.getAttribute("userId")).thenReturn(9L);
            when(request.getSession(false)).thenReturn(session);
        }
        return request;
    }
}
