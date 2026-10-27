package com.example.backend.controllers;

import com.example.backend.UserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AuthControllerTest {

    private final UserService userService = mock(UserService.class);
    private final AuthController controller = new AuthController(userService);

    @Test
    void sessionCheckReportsUnauthenticatedWhenSessionIsMissing() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getSession(false)).thenReturn(null);

        Map<String, Object> response = controller.session(request).getBody();

        assertEquals(Boolean.FALSE, response.get("success"));
    }

    @Test
    void sessionCheckReturnsAuthenticatedUserAndRole() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpSession session = mock(HttpSession.class);
        when(request.getSession(false)).thenReturn(session);
        when(session.getAttribute("username")).thenReturn("operator");
        when(session.getAttribute("role")).thenReturn("OPERATOR");
        when(session.getAttribute("userId")).thenReturn(7L);
        when(userService.isValidSession("operator", 7L, "OPERATOR")).thenReturn(true);

        Map<String, Object> response = controller.session(request).getBody();

        assertEquals(Boolean.TRUE, response.get("success"));
        assertEquals("operator", response.get("username"));
        assertEquals("OPERATOR", response.get("role"));
    }

    @Test
    void invalidatesSessionsForUnapprovedUsers() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpSession session = mock(HttpSession.class);
        when(request.getSession(false)).thenReturn(session);
        when(session.getAttribute("username")).thenReturn("pending");
        when(session.getAttribute("userId")).thenReturn(8L);
        when(session.getAttribute("role")).thenReturn("OPERATOR");
        when(userService.isValidSession("pending", 8L, "OPERATOR")).thenReturn(false);

        Map<String, Object> response = controller.session(request).getBody();

        assertEquals(Boolean.FALSE, response.get("success"));
        verify(session).invalidate();
    }
}
